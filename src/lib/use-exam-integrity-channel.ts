"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { ExamListenerRegistry } from "@/lib/exam-listener-registry";
import type { IntegrityEventType } from "@/lib/integrity-protocol";

export type IntegrityChannelStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "grace"
  | "locked";

type QueuedEvent = {
  version: 1;
  type: "event";
  event_id: string;
  sequence: number;
  occurred_at: string;
  event_type: IntegrityEventType;
  details: Record<string, string | number | boolean | null>;
};

type Options = {
  examId: string;
  enabled: boolean;
  accessTokenRef: RefObject<string | null>;
  listenerRegistryRef: RefObject<ExamListenerRegistry | null>;
  devToken?: string;
};

export function useExamIntegrityChannel({
  examId,
  enabled,
  accessTokenRef,
  listenerRegistryRef,
  devToken,
}: Options) {
  const [status, setStatus] = useState<IntegrityChannelStatus>("disconnected");
  const [lockReason, setLockReason] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const queueRef = useRef<QueuedEvent[]>([]);
  const pendingRef = useRef(new Map<string, QueuedEvent>());
  const sequenceRef = useRef(0);
  const heartbeatSequenceRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const lockedRef = useRef(false);

  const flush = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    for (const event of [...pendingRef.current.values()].sort((a, b) => a.sequence - b.sequence)) {
      socket.send(JSON.stringify(event));
    }
    while (queueRef.current.length) {
      const event = queueRef.current.shift();
      if (!event) continue;
      pendingRef.current.set(event.event_id, event);
      socket.send(JSON.stringify(event));
    }
  }, []);

  const sendEvent = useCallback(
    (
      eventType: IntegrityEventType,
      details: Record<string, string | number | boolean | null> = {},
    ) => {
      if (lockedRef.current) return;
      sequenceRef.current += 1;
      const event: QueuedEvent = {
        version: 1,
        type: "event",
        event_id: crypto.randomUUID(),
        sequence: sequenceRef.current,
        occurred_at: new Date().toISOString(),
        event_type: eventType,
        details,
      };
      queueRef.current.push(event);
      if (queueRef.current.length > 100) queueRef.current.shift();
      flush();
    },
    [flush],
  );

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;

    const healthInterval = window.setInterval(() => {
      listenerRegistryRef.current?.verifyAndRestore();
    }, 5_000);

    const connect = () => {
      if (stopped || lockedRef.current) return;
      setStatus(reconnectAttemptRef.current ? "reconnecting" : "connecting");
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${window.location.host}/api/exams/${examId}/integrity`);
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({
          version: 1,
          type: "authenticate",
          token: accessTokenRef.current ?? undefined,
          dev_token: devToken,
          client_build: process.env.NEXT_PUBLIC_BUILD_ID ?? "development",
        }));
      });
      socket.addEventListener("message", (event) => {
        try {
          const message = JSON.parse(String(event.data)) as {
            type?: string;
            event_id?: string;
            challenge_token?: string;
            reason?: string;
          };
          if (message.type === "authenticated") {
            reconnectAttemptRef.current = 0;
            setStatus("reconnecting");
            flush();
          } else if (message.type === "ack" && message.event_id) {
            pendingRef.current.delete(message.event_id);
          } else if (message.type === "heartbeat_challenge" && message.challenge_token) {
            const registry = listenerRegistryRef.current;
            registry?.verifyAndRestore();
            const health = registry?.health() ?? {
              version: "exam-listeners-pending",
              digest: "00000000",
              listenerCount: 0,
            };
            heartbeatSequenceRef.current += 1;
            socket.send(JSON.stringify({
              version: 1,
              type: "heartbeat",
              challenge_token: message.challenge_token,
              heartbeat_sequence: heartbeatSequenceRef.current,
              last_event_sequence: sequenceRef.current,
              registry_version: health.version,
              registry_digest: health.digest,
              listener_count: health.listenerCount,
              visibility_state: document.visibilityState ?? "unknown",
              lifecycle_state: document.hidden
                ? "hidden"
                : document.hasFocus()
                  ? "active"
                  : "passive",
              client_build: process.env.NEXT_PUBLIC_BUILD_ID ?? "development",
            }));
          } else if (message.type === "heartbeat_ack") {
            setStatus("connected");
          } else if (message.type === "locked") {
            lockedRef.current = true;
            setLockReason(message.reason ?? "Exam integrity was locked by the server.");
            setStatus("locked");
          }
        } catch {
          socket.close(1008, "Invalid server message");
        }
      });
      socket.addEventListener("close", (event) => {
        if (socketRef.current === socket) socketRef.current = null;
        if (stopped || lockedRef.current || event.code === 4403) return;
        reconnectAttemptRef.current += 1;
        setStatus(reconnectAttemptRef.current > 1 ? "grace" : "reconnecting");
        const delay = Math.min(5_000, 1_000 * 2 ** Math.min(2, reconnectAttemptRef.current - 1));
        reconnectTimerRef.current = window.setTimeout(connect, delay);
      });
      socket.addEventListener("error", () => socket.close());
    };

    connect();
    return () => {
      stopped = true;
      window.clearInterval(healthInterval);
      if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
      socketRef.current?.close(1000, "Exam channel closed");
      socketRef.current = null;
    };
  }, [accessTokenRef, devToken, enabled, examId, flush, listenerRegistryRef]);

  return { status, lockReason, sendEvent };
}
