import { beforeEach, describe, expect, it, vi } from "vitest";

type SessionUpdate = {
  $inc: { session_generation: number };
  $unset: { active_connection_id: string };
  $set: { access_token_hash: string; access_token_issued_at: Date };
};

const updateOne = vi.hoisted(() =>
  vi
    .fn<
      (
        filter: Record<string, unknown>,
        update: SessionUpdate,
      ) => Promise<{ matchedCount: number }>
    >()
    .mockResolvedValue({ matchedCount: 1 }),
);

vi.mock("@/models/ExamSession", () => ({
  ExamSession: { updateOne },
}));

vi.mock("@/models/Exam", () => ({ Exam: {} }));
vi.mock("@/lib/runtime", () => ({ isStandalone: () => false, assertStandaloneRequest: vi.fn() }));
vi.mock("@/lib/exam-attempt-policy", () => ({
  AttemptPolicyError: class AttemptPolicyError extends Error {},
  attemptPolicyStatement: vi.fn(),
  getAttemptPolicySnapshot: vi.fn(),
}));

import { isNewerSessionGeneration, issueExamAttemptToken } from "@/lib/exam-attempt";

describe("final session recovery token rotation", () => {
  beforeEach(() => updateOne.mockClear());

  it("issues a new token, increments the generation, and clears the old connection", async () => {
    const first = await issueExamAttemptToken("66f0a1b2c3d4e5f607182930");
    const second = await issueExamAttemptToken("66f0a1b2c3d4e5f607182930");

    expect(first).not.toBe(second);
    expect(updateOne).toHaveBeenCalledTimes(2);
    for (const [, update] of updateOne.mock.calls) {
      expect(update).toMatchObject({
        $inc: { session_generation: 1 },
        $unset: { active_connection_id: "" },
        $set: {
          access_token_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
          access_token_issued_at: expect.any(Date),
        },
      });
    }
    expect(updateOne.mock.calls[0][1].$set.access_token_hash)
      .not.toBe(updateOne.mock.calls[1][1].$set.access_token_hash);
  });

  it("replaces only an older socket generation", () => {
    expect(isNewerSessionGeneration(2, 1)).toBe(true);
    expect(isNewerSessionGeneration(2, 2)).toBe(false);
    expect(isNewerSessionGeneration(1, 2)).toBe(false);
  });
});
