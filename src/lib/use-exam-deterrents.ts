"use client";

import { useEffect, type RefObject } from "react";
import { ExamListenerRegistry } from "@/lib/exam-listener-registry";
import {
  getDevToolsDimensionSignal,
  getRestrictedShortcut,
} from "@/lib/proctoring-signals";
import type { IntegrityEventType } from "@/lib/integrity-protocol";

type SendEvent = (
  type: IntegrityEventType,
  details?: Record<string, string | number | boolean | null>,
) => void;

type Options = {
  enabled: boolean;
  registryRef: RefObject<ExamListenerRegistry | null>;
  sendEvent: SendEvent;
  onBlockedAction: (message: string) => void;
};

function roundedGap(value: number): number {
  return Math.max(0, Math.round(value / 50) * 50);
}

function blockedSourceCategory(value: string): string {
  if (!value) return "none";
  if (value === "inline" || value === "eval") return value;
  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin ? "same-origin" : "cross-origin";
  } catch {
    return "other";
  }
}

export function useExamDeterrents({
  enabled,
  registryRef,
  sendEvent,
  onBlockedAction,
}: Options): void {
  useEffect(() => {
    if (!enabled) return;
    const registry = new ExamListenerRegistry("exam-listeners-v2");
    registryRef.current = registry;
    let hiddenAt: number | null = null;
    let blurredAt: number | null = null;
    let resizeTimer: number | null = null;
    let consecutiveDimensionSignals = 0;
    let lastDimensionReportAt = 0;
    const tabId = crypto.randomUUID();

    const register = (
      name: string,
      target: EventTarget,
      type: string,
      handler: EventListener,
      options?: boolean | AddEventListenerOptions,
    ) => registry.register({ name, target, type, handler, options });

    const block = (
      event: Event,
      type: IntegrityEventType,
      message: string,
      details: Record<string, string | number | boolean | null> = {},
    ) => {
      event.preventDefault();
      event.stopPropagation();
      sendEvent(type, details);
      onBlockedAction(message);
    };

    register("visibility", document, "visibilitychange", () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        sendEvent("visibility_hidden", { state: "hidden" });
      } else {
        sendEvent("visibility_visible", {
          state: "visible",
          hidden_ms: hiddenAt === null ? 0 : Date.now() - hiddenAt,
        });
        hiddenAt = null;
      }
    });
    register("window-blur", window, "blur", () => {
      blurredAt = Date.now();
      sendEvent("window_blur", { document_hidden: document.hidden });
    });
    register("window-focus", window, "focus", () => {
      sendEvent("window_focus", {
        blurred_ms: blurredAt === null ? 0 : Date.now() - blurredAt,
      });
      blurredAt = null;
    });
    register("fullscreen-change", document, "fullscreenchange", () => {
      sendEvent(document.fullscreenElement ? "fullscreen_enter" : "fullscreen_exit", {
        active: Boolean(document.fullscreenElement),
      });
    });
    register("fullscreen-error", document, "fullscreenerror", () => {
      sendEvent("fullscreen_error", { supported: Boolean(document.fullscreenEnabled) });
    });
    register("restricted-shortcuts", document, "keydown", ((event: KeyboardEvent) => {
      const shortcut = getRestrictedShortcut(event);
      if (!shortcut) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      sendEvent("restricted_shortcut", { shortcut, confidence: "direct" });
      onBlockedAction(`${shortcut} is disabled during an active exam.`);
    }) as EventListener, { capture: true });
    register("context-menu", document, "contextmenu", (event) => {
      block(event, "context_menu_attempt", "Right-click is disabled during an active exam.", {
        target: event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
          ? "answer-control"
          : "exam-content",
      });
    }, { capture: true });

    for (const clipboardType of ["copy", "cut", "paste"] as const) {
      register(`clipboard-${clipboardType}`, document, clipboardType, (event) => {
        const eventType = `clipboard_${clipboardType}_attempt` as IntegrityEventType;
        block(event, eventType, `${clipboardType[0].toUpperCase()}${clipboardType.slice(1)} is disabled during an active exam.`, {
          target: event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
            ? "answer-control"
            : "exam-content",
        });
      }, { capture: true });
    }

    register("drag-start", document, "dragstart", (event) => {
      block(event, "drag_start_attempt", "Dragging exam content is disabled.", { target: "exam-content" });
    }, { capture: true });
    register("drop", document, "drop", ((event: DragEvent) => {
      block(event, "drop_attempt", "Dropping content into the exam is disabled.", {
        item_count: event.dataTransfer?.items.length ?? 0,
      });
    }) as EventListener, { capture: true });

    register("resize", window, "resize", () => {
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        sendEvent("viewport_resize", {
          width_gap: roundedGap(window.outerWidth - window.innerWidth),
          height_gap: roundedGap(window.outerHeight - window.innerHeight),
        });
      }, 500);
    });

    register("page-hide", window, "pagehide", ((event: PageTransitionEvent) => {
      sendEvent("page_hidden", { persisted: event.persisted });
    }) as EventListener);
    register("page-show", window, "pageshow", ((event: PageTransitionEvent) => {
      sendEvent("page_shown", {
        persisted: event.persisted,
        was_discarded: Boolean((document as Document & { wasDiscarded?: boolean }).wasDiscarded),
      });
    }) as EventListener);
    register("page-freeze", document, "freeze", () => sendEvent("page_frozen"));
    register("page-resume", document, "resume", () => sendEvent("page_resumed"));
    register("network-online", window, "online", () => sendEvent("network_online"));
    register("network-offline", window, "offline", () => sendEvent("network_offline"));
    register("history-navigation", window, "popstate", () => {
      sendEvent("history_navigation_attempt");
      onBlockedAction("Leaving this page can pause your exam. Use the exam controls instead.");
    });
    register("before-print", window, "beforeprint", () => {
      sendEvent("print_attempt");
      onBlockedAction("Printing is not allowed during an active exam.");
    });
    register("after-print", window, "afterprint", () => sendEvent("print_dialog_closed"));
    register("csp-violation", document, "securitypolicyviolation", ((event: SecurityPolicyViolationEvent) => {
      sendEvent("csp_violation", {
        directive: event.effectiveDirective.slice(0, 120),
        blocked_source: blockedSourceCategory(event.blockedURI),
      });
    }) as EventListener);
    register("storage", window, "storage", ((event: StorageEvent) => {
      if (!event.key?.startsWith("univai-exam:")) return;
      sendEvent("attempt_storage_changed", { key_category: event.key.slice(0, 80) });
    }) as EventListener);

    const channel = typeof BroadcastChannel === "undefined"
      ? null
      : new BroadcastChannel("univai-exam-active-attempt");
    if (channel) {
      register("duplicate-tab", channel, "message", ((event: MessageEvent) => {
        const otherTab = typeof event.data === "object" && event.data
          ? String((event.data as { tabId?: unknown }).tabId ?? "")
          : "";
        if (!otherTab || otherTab === tabId) return;
        sendEvent("duplicate_attempt_context", { detected: true });
        onBlockedAction("Another tab opened this exam. The server may lock this attempt.");
      }) as EventListener);
      channel.postMessage({ tabId, state: "active" });
    }

    const mediaDevices = navigator.mediaDevices;
    if (mediaDevices) {
      register("media-device-change", mediaDevices, "devicechange", () => {
        void mediaDevices.enumerateDevices().then((devices) => {
          sendEvent("media_device_changed", {
            cameras: devices.filter((device) => device.kind === "videoinput").length,
            microphones: devices.filter((device) => device.kind === "audioinput").length,
          });
        }).catch(() => undefined);
      });
    }

    const dimensionInterval = window.setInterval(() => {
      const signal = getDevToolsDimensionSignal(window);
      consecutiveDimensionSignals = signal ? consecutiveDimensionSignals + 1 : 0;
      const now = Date.now();
      if (signal && consecutiveDimensionSignals >= 2 && now - lastDimensionReportAt >= 30_000) {
        lastDimensionReportAt = now;
        sendEvent("devtools_dimension_suspected", {
          confidence: "low",
          width_gap: roundedGap(signal.widthDiff),
          height_gap: roundedGap(signal.heightDiff),
        });
      }
    }, 3_000);

    return () => {
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      window.clearInterval(dimensionInterval);
      registry.dispose();
      channel?.close();
      if (registryRef.current === registry) registryRef.current = null;
    };
  }, [enabled, onBlockedAction, registryRef, sendEvent]);
}
