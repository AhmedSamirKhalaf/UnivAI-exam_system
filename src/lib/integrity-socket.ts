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
import { IntegrityEvent } from "@/models/IntegrityEvent";
import type { IExamSession } from "@/models/ExamSession";

type ConnectionState = {
  authenticated: boolean;
  connectionId: string;
  examId: string;
  clientBuild: string;
  session: IExamSession | null;
  lastSequence: number;
  messageCount: number;
  windowStartedAt: number;
};

function allowedOrigins(): Set<string> {
  const configured = (process.env.EXAM_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (configured.length) return new Set(configured);
  if (process.env.NODE_ENV === "production") return new Set();
  return new Set([
    "http://localhost:3200",
    "http://127.0.0.1:3200",
  ]);
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
    const { ExamSession } = await import("@/models/ExamSession");
    return ExamSession.findOne({ exam_id: state.examId, status: "in_progress" });
  }
  if (!token) return null;
  const session = await verifyExamAttemptToken(state.examId, token);
  return session?.status === "in_progress" ? session : null;
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
    return false;
  } catch (error: unknown) {
    if (isDuplicateKey(error)) return true;
    throw error;
  }
}

export function attachIntegrityWebSocketServer(
  server: HttpServer,
  fallbackUpgrade?: (request: IncomingMessage, socket: Duplex, head: Buffer) => void,
): WebSocketServer {
  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: 64 * 1024,
  });
  const origins = allowedOrigins();

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

    wss.handleUpgrade(request, socket, head, (webSocket) => {
      wss.emit("connection", webSocket, request);
    });
  });

  wss.on("connection", (socket, request) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    const examIdValue = pathname.split("/")[3] ?? "";
    const state: ConnectionState = {
      authenticated: false,
      connectionId: randomUUID(),
      examId: String(examIdValue),
      clientBuild: "unknown",
      session: null,
      lastSequence: 0,
      messageCount: 0,
      windowStartedAt: Date.now(),
    };

    const authenticationTimeout = setTimeout(() => {
      if (!state.authenticated) close(socket, 1008, "Authentication timeout");
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
          if (!session) return close(socket, 1008, "Exam authentication failed");
          state.authenticated = true;
          state.session = session;
          state.clientBuild = message.client_build;
          clearTimeout(authenticationTimeout);
          send(socket, {
            version: 1,
            type: "authenticated",
            connection_id: state.connectionId,
          });
          return;
        }

        if (!state.authenticated) return close(socket, 1008, "Authenticate first");
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

    socket.on("close", () => clearTimeout(authenticationTimeout));
  });

  return wss;
}
