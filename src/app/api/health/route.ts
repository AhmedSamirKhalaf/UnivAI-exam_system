import { connectDB } from "@/lib/db";
import {
  STANDALONE_SEED_VERSION,
  isStandalone,
} from "@/lib/runtime";
import { Exam } from "@/models/Exam";
import { AUDIT_SCHEMA_VERSION, INTEGRITY_POLICY_VERSION } from "@/lib/audit-log";
import { loadRateLimitConfig } from "@/lib/rate-limit";
import { trustedServiceAuthConfigured } from "@/lib/request-validation";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await connectDB();
    const seededScenarios = isStandalone()
      ? await Exam.countDocuments({
          _id: {
            $in: [
              "64b000000000000000000021",
              "64b000000000000000000022",
              "64b000000000000000000023",
              "64b000000000000000000024",
              "64b000000000000000000025",
            ],
          },
        })
      : null;
    const serviceAuth = trustedServiceAuthConfigured();
    if (!serviceAuth) {
      return Response.json(
        {
          ok: true,
          ready: false,
          mode: "integrated",
          mongo: "ready",
          trusted_service_auth: "unconfigured",
        },
        { status: 503 },
      );
    }
    return Response.json({
      ok: true,
      ready: true,
      mode: isStandalone() ? "standalone" : "integrated",
      mongo: "ready",
      trusted_service_auth: "ready",
      seed: isStandalone() ? STANDALONE_SEED_VERSION : null,
      seededScenarios,
      webhook: isStandalone() ? "local capture" : "configured callback",
      hardening: {
        request_validation: "strict-schemas-v1",
        rate_limits: loadRateLimitConfig(),
        idempotency: "enabled",
        audit_schema: AUDIT_SCHEMA_VERSION,
        integrity_policy: INTEGRITY_POLICY_VERSION,
      },
    });
  } catch (error) {
    return Response.json(
      {
        ok: true,
        ready: false,
        mode: process.env.UNIVAI_MODE ?? "integrated",
        mongo: "unavailable",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 503 }
    );
  }
}
