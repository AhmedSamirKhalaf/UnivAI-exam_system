(() => {
  "use strict";

  const stateKey = "__univaiExamDebugDeterrent";
  const stopEventName = "univai:stop-debug-deterrent";
  const requestedInterval = Number(
    new URL(document.currentScript?.src ?? window.location.href).searchParams.get("interval_ms"),
  );
  const intervalMs = Number.isFinite(requestedInterval)
    ? Math.max(25, Math.min(250, Math.round(requestedInterval)))
    : 50;
  const existing = window[stateKey];
  if (existing?.active) {
    existing.intervalMs = intervalMs;
    return;
  }

  const state = { active: true, intervalMs, timerId: 0 };
  window[stateKey] = state;

  const stop = () => {
    state.active = false;
    window.clearTimeout(state.timerId);
    if (window[stateKey] === state) delete window[stateKey];
    window.removeEventListener(stopEventName, stop);
  };

  const pauseWhenInspectorIsListening = () => {
    if (!state.active) return;
    debugger;
    if (state.active) {
      state.timerId = window.setTimeout(
        pauseWhenInspectorIsListening,
        state.intervalMs,
      );
    }
  };

  window.addEventListener(stopEventName, stop);
  pauseWhenInspectorIsListening();
})();
