import mongoose from "mongoose";
import { describe, expect, it } from "vitest";

import {
  prepareLegacyFinalForms,
  preparePublishedFinalForms,
} from "@/lib/business-logic";

const BLUEPRINT_ID = new mongoose.Types.ObjectId("66f0a1b2c3d4e5f607182930");

function question(packageId: string, index: number) {
  const correct = "A) Correct";
  return {
    blueprint_id: BLUEPRINT_ID,
    package_id: packageId,
    schema_version: "question-provenance-v1",
    question_id: `${packageId}-q${index}`,
    prompt: `Question ${index} from ${packageId}`,
    type: "mcq",
    options: [correct, "B) No", "C) No", "D) No", "E) No", "F) No"],
    correct_option: correct,
    plan_version: "plan-v3",
    approved: true,
    provenance: {
      document_id: "book-1",
      document_title: "Reliable Systems",
      page_number: index,
      section: `Section ${index}`,
    },
  };
}

describe("final reserve-form preparation", () => {
  it("binds two complete generated packages to distinct immutable forms", () => {
    const forms = preparePublishedFinalForms([
      ...Array.from({ length: 10 }, (_, index) => question("package-primary", index + 1)),
      ...Array.from({ length: 10 }, (_, index) => question("package-reserve", index + 1)),
    ]);
    expect(forms.map((form) => form.form)).toEqual(["primary", "retake"]);
    expect(new Set(forms.map((form) => form.packageId)).size).toBe(2);
    const primaryIds = new Set(forms[0].questions.map((item) => item.question_id));
    expect(forms[1].questions.every((item) => !primaryIds.has(item.question_id))).toBe(true);
  });

  it("fails closed when only one generated final package exists", () => {
    expect(() => preparePublishedFinalForms(
      Array.from({ length: 10 }, (_, index) => question("only-package", index + 1)),
    )).toThrow(/Two distinct published final packages are required/);
  });

  it("rejects packages with unequal lengths or duplicated paper content", () => {
    const primary = Array.from(
      { length: 10 },
      (_, index) => question("package-primary", index + 1),
    );
    expect(() =>
      preparePublishedFinalForms([
        ...primary,
        ...Array.from(
          { length: 11 },
          (_, index) => question("package-reserve", index + 1),
        ),
      ]),
    ).toThrow(/same number of questions/);

    expect(() =>
      preparePublishedFinalForms([
        ...primary,
        ...primary.map((item, index) => ({
          ...item,
          package_id: "package-reserve",
          question_id: `reserve-id-${index}`,
        })),
      ]),
    ).toThrow(/must not reuse question content/);
  });

  it("splits a legacy bank into two disjoint ten-question forms", () => {
    const legacy = Array.from({ length: 20 }, (_, index) => ({
      ...question("legacy", index + 1),
      package_id: undefined,
    }));
    const forms = prepareLegacyFinalForms(legacy, BLUEPRINT_ID);
    expect(forms[0].questions).toHaveLength(10);
    expect(forms[1].questions).toHaveLength(10);
    const primaryIds = new Set(forms[0].questions.map((item) => item.question_id));
    expect(forms[1].questions.every((item) => !primaryIds.has(item.question_id))).toBe(true);
  });
});
