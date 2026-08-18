import { createHash, timingSafeEqual } from "node:crypto";
import { assertStandaloneRequest, isStandalone } from "@/lib/runtime";

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** Authorize server-to-server assessment package calls without timing leaks. */
export function requireTrustedAgentRequest(request: Request): void {
  if (isStandalone()) {
    assertStandaloneRequest(request);
    return;
  }
  const secret = process.env.UNIVAI_AGENT_SECRET?.trim();
  const provided = request.headers.get("x-univai-agent-token")?.trim();
  if (!secret || !provided || !timingSafeEqual(digest(secret), digest(provided))) {
    throw new TrustedAgentError();
  }
}

export class TrustedAgentError extends Error {
  readonly status = 401;

  constructor() {
    super("A valid Agent token is required to start practice packages");
    this.name = "TrustedAgentError";
  }
}
