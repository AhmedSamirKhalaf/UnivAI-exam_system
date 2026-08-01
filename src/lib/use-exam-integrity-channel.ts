"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { IntegrityEventType } from "@/lib/integrity-protocol";

export type IntegrityChannelStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";

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
  devToken?: string;
};

export function useExamIntegrityChannel({
  examId,
  enabled,
  accessTokenRef,
  devToken,
}: Options) {
  const [status, setStatus] = useState<IntegrityChannelStatus>("disconnected");
  const socketRef = useRef<WebSocket | null>(null);
  const queueRef = useRef<QueuedEvent[]>([]);
  const sequenceRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);

  const flush = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    while (queueRef.current.length) {
      const next = queueRef.current.shift();
      if (next) socket.send(JSON.stringify(next));
    }
  }, []);

  const sendEvent = useCallback(
    (
      eventType: IntegrityEventType,
      details: Record<string, string | number | boolean | null> = {},
    ) => {
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

    const connect = () => {
      if (stopped) return;
      setStatus(reconnectAttemptRef.current ? "reconnecting" : "connecting");
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(
        `${protocol}//${window.location.host}/api/exams/${examId}/integrity`,
      );
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
          const message = JSON.parse(String(event.data)) as { type?: string };
          if (message.type === "authenticated") {
            reconnectAttemptRef.current = 0;
            setStatus("connected");
            flush();
          }
        } catch {
          socket.close(1008, "Invalid server message");
        }
      });
      socket.addEventListener("close", () => {
        if (socketRef.current === socket) socketRef.current = null;
        if (stopped) return;
        reconnectAttemptRef.current += 1;
        setStatus("reconnecting");
        const delay = Math.min(5_000, 1_000 * 2 ** Math.min(2, reconnectAttemptRef.current - 1));
        reconnectTimerRef.current = window.setTimeout(connect, delay);
      });
      socket.addEventListener("error", () => socket.close());
    };

    connect();
    return () => {
      stopped = true;
      if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
      socketRef.current?.close(1000, "Exam channel closed");
      socketRef.current = null;
      setStatus("disconnected");
    };
  }, [accessTokenRef, devToken, enabled, examId, flush]);

  return { status, sendEvent };
}
