export type RegisteredExamListener = {
  name: string;
  target: EventTarget;
  type: string;
  handler: EventListener;
  options?: boolean | AddEventListenerOptions;
};

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export class ExamListenerRegistry {
  private readonly listeners = new Map<string, RegisteredExamListener>();

  constructor(readonly version: string) {}

  register(listener: RegisteredExamListener): void {
    const existing = this.listeners.get(listener.name);
    if (existing) {
      existing.target.removeEventListener(existing.type, existing.handler, existing.options);
    }
    listener.target.addEventListener(listener.type, listener.handler, listener.options);
    this.listeners.set(listener.name, listener);
  }

  verifyAndRestore(): void {
    for (const listener of this.listeners.values()) {
      listener.target.removeEventListener(listener.type, listener.handler, listener.options);
      listener.target.addEventListener(listener.type, listener.handler, listener.options);
    }
  }

  health(): { version: string; digest: string; listenerCount: number } {
    const descriptor = [...this.listeners.values()]
      .map((listener) => `${listener.name}:${listener.type}`)
      .sort()
      .join("|");
    return {
      version: this.version,
      digest: fnv1a(`${this.version}|${descriptor}`),
      listenerCount: this.listeners.size,
    };
  }

  dispose(): void {
    for (const listener of this.listeners.values()) {
      listener.target.removeEventListener(listener.type, listener.handler, listener.options);
    }
    this.listeners.clear();
  }
}
