(() => {
  "use strict";

  const pauseWhenInspectorIsListening = () => {
    debugger;
    setTimeout(pauseWhenInspectorIsListening, 1250);
  };

  pauseWhenInspectorIsListening();
})();
