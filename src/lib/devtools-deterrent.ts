"use client";

export const EXAM_DEBUG_DETERRENT_PATH = "/exam-debug-deterrent.js";
export const EXAM_DEBUG_PROBE_INTERVAL_MS = 50;
export const EXAM_DEBUG_STOP_EVENT = "univai:stop-debug-deterrent";

type EnsureOptions = {
  nonce: string;
  intervalMs?: number;
  scriptPath?: string;
};

export function ensureExamDebugDeterrent({
  nonce,
  intervalMs = EXAM_DEBUG_PROBE_INTERVAL_MS,
  scriptPath = EXAM_DEBUG_DETERRENT_PATH,
}: EnsureOptions): void {
  const safeInterval = Math.max(25, Math.min(250, Math.round(intervalMs)));
  const query = new URLSearchParams({
    interval_ms: safeInterval.toString(),
    nonce,
  });
  const script = document.createElement("script");
  script.src = `${scriptPath}?${query.toString()}`;
  script.async = true;
  script.dataset.univaiExamDeterrent = "active";
  script.addEventListener("load", () => script.remove(), { once: true });
  script.addEventListener("error", () => script.remove(), { once: true });
  document.head.appendChild(script);
}

export function stopExamDebugDeterrent(): void {
  window.dispatchEvent(new Event(EXAM_DEBUG_STOP_EVENT));
  document
    .querySelectorAll<HTMLScriptElement>("script[data-univai-exam-deterrent]")
    .forEach((script) => script.remove());
}
