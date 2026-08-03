import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";

const originalToken = process.env.UNIVAI_AGENT_SECRET;
const originalMode = process.env.UNIVAI_MODE;
const originalMongoUri = process.env.MONGODB_URI;
process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27018/univai_exams_test";

async function post(request: Request) {
  const route = await import(
    "../../src/app/api/assessments/midterm/publish/route"
  );
  return route.POST(request);
}

function request(
  body: unknown,
  token = "agent-test-token",
) {
  return new Request("http://exam.local/api/assessments/midterm/publish", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-univai-agent-token": token,
    },
    body: JSON.stringify(body),
  });
}

describe("grounded midterm publication boundary", () => {
  beforeEach(() => {
    process.env.UNIVAI_MODE = "integrated";
    process.env.UNIVAI_AGENT_SECRET = "agent-test-token";
  });

  after(() => {
    if (originalToken === undefined) {
      delete process.env.UNIVAI_AGENT_SECRET;
    } else {
      process.env.UNIVAI_AGENT_SECRET = originalToken;
    }
    if (originalMode === undefined) {
      delete process.env.UNIVAI_MODE;
    } else {
      process.env.UNIVAI_MODE = originalMode;
    }
    if (originalMongoUri === undefined) {
      delete process.env.MONGODB_URI;
    } else {
      process.env.MONGODB_URI = originalMongoUri;
    }
  });

  test("requires Agent credentials before reading or publishing input", async () => {
    const response = await post(request({}, "wrong-token"));

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      error: "Valid Agent publication credentials are required",
      defects: [],
    });
  });

  test("fails closed when publication authentication is not configured", async () => {
    delete process.env.UNIVAI_AGENT_SECRET;

    const response = await post(request({}));

    assert.equal(response.status, 503);
  });

  test("returns machine-readable schema defects before database work", async () => {
    const response = await post(
      request({ schema_version: "midterm-package-v1" }),
    );
    const payload = await response.json();

    assert.equal(response.status, 422);
    assert.ok(Array.isArray(payload.defects));
    assert.ok(
      payload.defects.some(
        (item: { code?: string }) => item.code === "SCHEMA_INVALID",
      ),
    );
    assert.equal("questions" in payload, false);
    assert.equal("correct_option" in payload, false);
  });

  test("midterm download projection excludes learner data, keys, and future questions", async () => {
    const { examToPlain } = await import("../../src/lib/business-logic");
    const projected = examToPlain({
      toObject: () => ({
        _id: "64b000000000000000000201",
        type: "mid",
        title: "Grounded midterm",
        taken: false,
        student_id: "64b000000000000000000202",
        mark: 6,
        generated_questions: [{ question_id: "q-1", prompt: "Future" }],
        questions_snapshot: [{ question_id: "q-1", correct_option: "A" }],
        publication_key: "private-publication-key",
      }),
    });

    assert.deepEqual(projected, {
      _id: "64b000000000000000000201",
      type: "mid",
      title: "Grounded midterm",
      taken: false,
    });
  });
});
