import assert from "node:assert/strict";
import test from "node:test";
import {
  examDirection,
  localizeServerMessage,
  normalizeExamLocale,
  resolveExamLocale,
  translateExam,
} from "../src/i18n/exam-locale";

test("normalizes supported Arabic and English language tags", () => {
  assert.equal(normalizeExamLocale("ar"), "ar");
  assert.equal(normalizeExamLocale("ar-EG"), "ar");
  assert.equal(normalizeExamLocale("en"), "en");
  assert.equal(normalizeExamLocale("en_US"), "en");
  assert.equal(normalizeExamLocale("fr"), null);
  assert.equal(normalizeExamLocale(""), null);
});

test("resolves uiLocale before lang before cookie before English", () => {
  assert.deepEqual(
    resolveExamLocale({ uiLocale: "ar", lang: "en", cookie: "en" }),
    { locale: "ar", selectedByQuery: true },
  );
  assert.deepEqual(
    resolveExamLocale({ uiLocale: "fr", lang: "ar", cookie: "en" }),
    { locale: "ar", selectedByQuery: true },
  );
  assert.deepEqual(resolveExamLocale({ cookie: "ar" }), {
    locale: "ar",
    selectedByQuery: false,
  });
  assert.deepEqual(resolveExamLocale({ uiLocale: "fr", cookie: "fr" }), {
    locale: "en",
    selectedByQuery: false,
  });
});

test("maps locale to document direction", () => {
  assert.equal(examDirection("ar"), "rtl");
  assert.equal(examDirection("en"), "ltr");
});

test("formats interpolation values in both dictionaries", () => {
  assert.equal(translateExam("en", "questionPosition", { position: 2, total: 5 }), "Question 2 of 5");
  assert.equal(translateExam("ar", "questionPosition", { position: 2, total: 5 }), "السؤال 2 من 5");
});

test("Arabic maps known server errors and never exposes unknown English prose", () => {
  assert.equal(localizeServerMessage("ar", "Exam not found"), "لم يتم العثور على الاختبار");
  const unknown = localizeServerMessage("ar", "Internal collection name and stack trace");
  assert.equal(unknown, translateExam("ar", "genericLocalizedError"));
  assert.doesNotMatch(unknown, /Internal|stack|trace/i);
});

test("English preserves server wording for backwards-compatible operator detail", () => {
  assert.equal(localizeServerMessage("en", "Exam not found"), "Exam not found");
  assert.equal(localizeServerMessage("en", "Detailed integration error"), "Detailed integration error");
});
