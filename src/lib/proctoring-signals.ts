export const DEVTOOLS_DIMENSION_THRESHOLD = 240;

type WindowDimensions = {
  outerWidth: number;
  innerWidth: number;
  outerHeight: number;
  innerHeight: number;
};

type ShortcutEvent = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

export type DevToolsDimensionSignal = {
  widthDiff: number;
  heightDiff: number;
};

/**
 * A large gap can indicate docked developer tools. It is only a weak signal:
 * callers must require repeated samples and store the measurements as metadata.
 */
export function getDevToolsDimensionSignal(
  dimensions: WindowDimensions,
): DevToolsDimensionSignal | null {
  const widthDiff = Math.max(0, dimensions.outerWidth - dimensions.innerWidth);
  const heightDiff = Math.max(0, dimensions.outerHeight - dimensions.innerHeight);

  if (
    widthDiff < DEVTOOLS_DIMENSION_THRESHOLD &&
    heightDiff < DEVTOOLS_DIMENSION_THRESHOLD
  ) {
    return null;
  }

  return { widthDiff, heightDiff };
}

/** Return a stable label for common developer-tools/source-view shortcuts. */
export function getRestrictedShortcut(event: ShortcutEvent): string | null {
  const key = event.key.toLowerCase();
  if (key === "f12") return "F12";

  const commandOrControl = event.ctrlKey || event.metaKey;
  if (commandOrControl && event.shiftKey && ["i", "j", "c"].includes(key)) {
    return `${event.metaKey ? "Meta" : "Ctrl"}+Shift+${key.toUpperCase()}`;
  }
  if (event.metaKey && event.altKey && ["i", "j", "c"].includes(key)) {
    return `Meta+Alt+${key.toUpperCase()}`;
  }
  if (commandOrControl && key === "u") {
    return `${event.metaKey ? "Meta" : "Ctrl"}+U`;
  }

  return null;
}
