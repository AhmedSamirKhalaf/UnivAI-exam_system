import { randomUUID } from "node:crypto";
import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { connectDB } from "@/lib/db";
import { verifyStandaloneToken, isStandalone } from "@/lib/runtime";
import { verifyExamAttemptToken } from "@/lib/exam-attempt";
import {
  evidenceValueFor,
  parseSocketPayload,
  type IntegrityEventType,
} from "@/lib/integrity-protocol";
import {
  createHeartbeatChallenge,
  heartbeatPolicy,
  verifyHeartbeatChallenge,
  type HeartbeatChallenge,
} from "@/lib/heartbeat-policy";
import { IntegrityEvent } from "@/models/IntegrityEvent";
import { ExamSession, type IExamSession, type TerminatedReason } from "@/models/ExamSession";

type ConnectionState = {
  authenticated: boolean;
  connectionId: string;
  examId: string;
  clientBuild: string;
  session: IExamSession | null;
  lastSequence: number;
  lastHeartbeatSequence: number;
  messageCount: number;
  windowStartedAt: number;
  pendingChallenge: HeartbeatChallenge | null;
  consecutiveMisses: number;
  graceUntil: number | null;
  heartbeatTimer: NodeJS.Timeout | null;
  heartbeatTicking: boolean;
  locked: boolean;
};

type ActiveConnection = { socket: WebSocket; state: ConnectionState };

function allowedOrigins(): Set<string> {
  const configured = (process.env.EXAM_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (configured.length) return new Set(configured);
  if (process.env.NODE_ENV === "production") return new Set();
  return new Set(["http://localhost:3200", "http://127.0.0.1:3200"]);
}

function send(socket: WebSocket, message: Record<string, unknown>): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function close(socket: WebSocket, code: number, reason: string): void {
  if (socket.readyState === WebSocket.OPEN) socket.close(code, reason.slice(0, 120));
}

function isDuplicateKey(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: number }).code === 11000,
  );
}

async function authenticate(
  state: ConnectionState,
  token: string | undefined,
  devToken: string | undefined,
): Promise<IExamSession | null> {
  if (isStandalone()) {
    if (!verifyStandaloneToken(devToken ?? null)) return null;
    return ExamSession.findOne({ exam_id: state.examId, status: "in_progress" });
  }
  if (!token) return null;
  const session = await verifyExamAttemptToken(state.examId, token);
  return session?.status === "in_progress" ? session : null;
}

async function updateSessionState(
  state: ConnectionState,
  integrityState: "active" | "reconnecting" | "grace",
  extra: Record<string, unknown> = {},
): Promise<void> {
  if (!state.session) return;
  await ExamSession.updateOne(
    { _id: state.session._id, status: "in_progress", integrity_state: { $ne: "integrity_locked" } },
    { $set: { integrity_state: integrityState, ...extra } },
  );
  state.session.integrity_state = integrityState;
}

async function lockSession(
  state: ConnectionState,
  socket: WebSocket,
  reason: string,
  terminatedReason: TerminatedReason,
): Promise<void> {
  if (!state.session || state.locked) return;
  state.locked = true;
  if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
  await ExamSession.updateOne(
    { _id: state.session._id, status: "in_progress" },
    {
      $set: {
        status: "terminated",
        integrity_state: "integrity_locked",
        integrity_lock_reason: reason,
        terminated_reason: terminatedReason,
        ended_at: new Date(),
        heartbeat_consecutive_misses: state.consecutiveMisses,
      },
    },
  );
  send(socket, { version: 1, type: "locked", reason });
  close(socket, 4403, "Exam integrity locked");
}

async function recordEvent(
  state: ConnectionState,
  event: {
    event_id: string;
    sequence: number;
    event_type: IntegrityEventType;
    occurred_at: string;
    details: Record<string, string | number | boolean | null>;
  },
): Promise<boolean> {
  if (!state.session) throw new Error("Exam session is not authenticated");
  try {
    await IntegrityEvent.create({
      exam_id: state.session.exam_id,
      student_id: state.session.student_id,
      connection_id: state.connectionId,
      event_id: event.event_id,
      sequence: event.sequence,
      event_type: event.event_type,
      evidence_value: evidenceValueFor(event.event_type),
      occurred_at: new Date(event.occurred_at),
      received_at: new Date(),
      client_build: state.clientBuild,
      details: event.details,
    });
    await ExamSession.updateOne(
      { _id: state.session._id, active_connection_id: state.connectionId },
      { $max: { last_integrity_sequence: event.sequence } },
    );
    return false;
  } catch (error: unknown) {
    if (isDuplicateKey(error)) return true;
    throw error;
  }
}

function issueChallenge(state: ConnectionState, socket: WebSocket): void {
  const challenge = createHeartbeatChallenge(state.examId, state.connectionId);
  state.pendingChallenge = challenge.payload;
  send(socket, {
    version: 1,
    type: "heartbeat_challenge",
    challenge_token: challenge.token,
    expires_at: new Date(challenge.payload.expires_at).toISOString(),
  });
}

async function heartbeatTick(state: ConnectionState, socket: WebSocket): Promise<void> {
  if (state.heartbeatTicking || state.locked || !state.authenticated) return;
  state.heartbeatTicking = true;
  try {
    const policy = heartbeatPolicy();
    const now = Date.now();
    if (state.pendingChallenge) {
      state.consecutiveMisses += 1;
      if (state.consecutiveMisses === 1) {
        state.graceUntil = now + policy.graceMs;
        await updateSessionState(state, "reconnecting", {
          heartbeat_consecutive_misses: state.consecutiveMisses,
          heartbeat_grace_until: new Date(state.graceUntil),
        });
      } else {
        await updateSessionState(state, "grace", {
          heartbeat_consecutive_misses: state.consecutiveMisses,
        });
      }
      if (
        state.consecutiveMisses >= policy.maximumMisses &&
        state.graceUntil !== null &&
        now >= state.graceUntil
      ) {
        await lockSession(state, socket, "Heartbeat grace period expired", "heartbeat_failure");
        return;
      }
    }
    issueChallenge(state, socket);
  } finally {
    state.heartbeatTicking = false;
  }
}

export function attachIntegrityWebSocketServer(
  server: HttpServer,
  fallbackUpgrade?: (request: IncomingMessage, socket: Duplex, head: Buffer) => void,
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 64 * 1024 });
  const origins = allowedOrigins();
  const activeConnections = new Map<string, ActiveConnection>();

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const match = url.pathname.match(/^\/api\/exams\/([0-9a-fA-F]{24})\/integrity$/);
    if (!match) {
      if (fallbackUpgrade) fallbackUpgrade(request, socket, head);
      else socket.destroy();
      return;
    }
    const origin = request.headers.origin ?? "";
    if (!origins.has(origin)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (webSocket) => wss.emit("connection", webSocket, request));
  });

  wss.on("connection", (socket, request) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    const state: ConnectionState = {
      authenticated: false,
      connectionId: randomUUID(),
      examId: pathname.split("/")[3] ?? "",
      clientBuild: "unknown",
      session: null,
      lastSequence: 0,
      lastHeartbeatSequence: 0,
      messageCount: 0,
      windowStartedAt: Date.now(),
      pendingChallenge: null,
      consecutiveMisses: 0,
      graceUntil: null,
      heartbeatTimer: null,
      heartbeatTicking: false,
      locked: false,
    };

    const authenticationTimeout = setTimeout(() => {
      if (!state.authenticated) close(socket, 4401, "Authentication timeout");
    }, 5_000);

    socket.on("message", async (data, isBinary) => {
      if (isBinary) return close(socket, 1003, "Binary messages are not supported");
      try {
        const now = Date.now();
        if (now - state.windowStartedAt >= 10_000) {
          state.windowStartedAt = now;
          state.messageCount = 0;
        }
        state.messageCount += 1;
        if (state.messageCount > 100) return close(socket, 1008, "Message rate exceeded");

        const message = parseSocketPayload(data.toString("utf8"));
        if (message.type === "authenticate") {
          if (state.authenticated) return close(socket, 1008, "Already authenticated");
          await connectDB();
          const session = await authenticate(state, message.token, message.dev_token);
          if (!session) return close(socket, 4401, "Exam authentication failed");
          state.authenticated = true;
          state.session = session;
          state.clientBuild = message.client_build;
          clearTimeout(authenticationTimeout);

          const existing = activeConnections.get(state.examId);
          if (existing && existing.socket.readyState === WebSocket.OPEN) {
            await lockSession(state, socket, "A second active exam connection was opened", "duplicate_session");
            send(existing.socket, { version: 1, type: "locked", reason: "A second active exam connection was opened" });
            close(existing.socket, 4403, "Duplicate exam connection");
            return;
          }
          activeConnections.set(state.examId, { socket, state });
          await updateSessionState(state, "reconnecting", {
            active_connection_id: state.connectionId,
            heartbeat_consecutive_misses: 0,
            heartbeat_client_build: state.clientBuild,
            integrity_lock_reason: null,
          });
          send(socket, { version: 1, type: "authenticated", connection_id: state.connectionId });
          issueChallenge(state, socket);
          state.heartbeatTimer = setInterval(
            () => void heartbeatTick(state, socket),
            heartbeatPolicy().intervalMs,
          );
          return;
        }

        if (!state.authenticated || !state.session) return close(socket, 1008, "Authenticate first");

        if (message.type === "heartbeat") {
          try {
            const payload = verifyHeartbeatChallenge(
              message.challenge_token,
              state.examId,
              state.connectionId,
            );
            if (!state.pendingChallenge || payload.nonce !== state.pendingChallenge.nonce) {
              throw new Error("Heartbeat challenge was replayed or replaced");
            }
            if (message.heartbeat_sequence <= state.lastHeartbeatSequence) {
              throw new Error("Heartbeat sequence is not increasing");
            }
            state.pendingChallenge = null;
            state.lastHeartbeatSequence = message.heartbeat_sequence;
            state.consecutiveMisses = 0;
            state.graceUntil = null;
            await updateSessionState(state, "active", {
              heartbeat_last_seen_at: new Date(),
              heartbeat_consecutive_misses: 0,
              heartbeat_grace_until: null,
              heartbeat_registry_version: message.registry_version,
              heartbeat_registry_digest: message.registry_digest,
              heartbeat_client_build: message.client_build,
              last_integrity_sequence: message.last_event_sequence,
            });
            send(socket, {
              version: 1,
              type: "heartbeat_ack",
              heartbeat_sequence: message.heartbeat_sequence,
              state: "active",
            });
          } catch (error: unknown) {
            await lockSession(
              state,
              socket,
              error instanceof Error ? error.message : "Heartbeat validation failed",
              "protocol_failure",
            );
          }
          return;
        }

        if (message.sequence <= state.lastSequence) {
          return close(socket, 1008, "Event sequence is not increasing");
        }
        const duplicate = await recordEvent(state, message);
        state.lastSequence = message.sequence;
        send(socket, {
          version: 1,
          type: "ack",
          event_id: message.event_id,
          sequence: message.sequence,
          duplicate,
          received_at: new Date().toISOString(),
        });
      } catch (error: unknown) {
        send(socket, {
          version: 1,
          type: "error",
          message: error instanceof Error ? error.message : "Invalid integrity message",
        });
        close(socket, 1008, "Invalid integrity message");
      }
    });

    socket.on("close", () => {
      clearTimeout(authenticationTimeout);
      if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
      const active = activeConnections.get(state.examId);
      if (active?.state.connectionId === state.connectionId) activeConnections.delete(state.examId);
      if (!state.authenticated || !state.session || state.locked) return;

      const policy = heartbeatPolicy();
      const graceUntil = new Date(Date.now() + policy.graceMs);
      void ExamSession.updateOne(
        { _id: state.session._id, status: "in_progress", active_connection_id: state.connectionId },
        {
          $set: {
            integrity_state: "reconnecting",
            heartbeat_grace_until: graceUntil,
          },
        },
      );
      setTimeout(() => {
        void ExamSession.updateOne(
          {
            _id: state.session?._id,
            status: "in_progress",
            active_connection_id: state.connectionId,
            integrity_state: { $in: ["reconnecting", "grace"] },
          },
          {
            $set: {
              status: "terminated",
              integrity_state: "integrity_locked",
              integrity_lock_reason: "Integrity channel did not reconnect before grace expired",
              terminated_reason: "heartbeat_failure",
              ended_at: new Date(),
            },
          },
        );
      }, policy.graceMs);
    });
  });

  return wss;
}
