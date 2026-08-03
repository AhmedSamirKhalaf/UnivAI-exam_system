import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { connectDB } from "../../../../../lib/db";
import {
  MidtermPublicationError,
  midtermPackageV1Schema,
  publishMidtermPackage,
} from "../../../../../lib/midterm-publication";
import {
  parseJsonBody,
  requestValidationErrorResponse,
} from "../../../../../lib/request-validation";
import {
  assertStandaloneRequest,
  isStandalone,
} from "../../../../../lib/runtime";

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function publicationActor(request: Request): string {
  if (isStandalone()) {
    try {
      assertStandaloneRequest(request);
      return "midterm-agent-publisher";
    } catch {
      throw new MidtermPublicationError(
        "Valid standalone publication credentials are required",
        401,
      );
    }
  }

  const configuredToken = process.env.UNIVAI_AGENT_SECRET?.trim();
  if (!configuredToken) {
    throw new MidtermPublicationError(
      "Midterm publication authentication is not configured",
      503,
    );
  }

  const suppliedToken = request.headers.get("x-univai-agent-token")?.trim();
  if (
    !suppliedToken ||
    !timingSafeEqual(digest(configuredToken), digest(suppliedToken))
  ) {
    throw new MidtermPublicationError(
      "Valid Agent publication credentials are required",
      401,
    );
  }

  return "midterm-agent-publisher";
}

export async function POST(request: Request) {
  try {
    const actorId = publicationActor(request);
    const body = await parseJsonBody(request, z.unknown());
    const parsed = midtermPackageV1Schema.safeParse(body);
    if (!parsed.success) {
      throw new MidtermPublicationError(
        "Midterm package schema is invalid",
        422,
        parsed.error.issues.map((issue) => ({
          code: "SCHEMA_INVALID",
          path: issue.path.length ? issue.path.join(".") : "root",
          message: issue.message,
        })),
      );
    }
    await connectDB();
    const receipt = await publishMidtermPackage(parsed.data, actorId);
    return Response.json(
      { publication: receipt },
      { status: receipt.idempotent ? 200 : 201 },
    );
  } catch (error: unknown) {
    const validationResponse = requestValidationErrorResponse(error);
    if (validationResponse) return validationResponse;
    if (error instanceof MidtermPublicationError) {
      return Response.json(
        {
          error: error.message,
          defects: error.defects,
        },
        { status: error.status },
      );
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 },
    );
  }
}
