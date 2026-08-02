(() => {
  "use strict";

  const stopEventName = "univai:stop-debug-deterrent";
  let active = true;
  let timerId = 0;

  const stop = () => {
    active = false;
    window.clearTimeout(timerId);
    window.removeEventListener(stopEventName, stop);
  };

  const pauseWhenInspectorIsListening = () => {
    if (!active) return;
    debugger;
    if (active) timerId = window.setTimeout(pauseWhenInspectorIsListening, 1250);
  };

  window.addEventListener(stopEventName, stop);
  pauseWhenInspectorIsListening();
})();
