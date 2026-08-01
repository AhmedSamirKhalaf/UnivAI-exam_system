import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getRestrictedShortcut } from "../src/lib/proctoring-signals";

const base = {
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
};

test("restricted shortcut coverage includes Chromium Firefox Safari and screenshots", () => {
  assert.equal(getRestrictedShortcut({ ...base, key: "F12" }), "F12");
  assert.equal(getRestrictedShortcut({ ...base, key: "PrintScreen" }), "PrintScreen");
  assert.equal(
    getRestrictedShortcut({ ...base, key: "k", ctrlKey: true, shiftKey: true }),
    "Ctrl+Shift+K",
  );
  assert.equal(
    getRestrictedShortcut({ ...base, key: "z", ctrlKey: true, shiftKey: true }),
    "Ctrl+Shift+Z",
  );
  assert.equal(
    getRestrictedShortcut({ ...base, key: "u", metaKey: true, altKey: true }),
    "Meta+Alt+U",
  );
  assert.equal(getRestrictedShortcut({ ...base, key: "c", ctrlKey: true }), null);
});

test("deterrent implementation has no debugger trap or sensitive payload collection", async () => {
  const source = await readFile(
    new URL("../src/lib/use-exam-deterrents.ts", import.meta.url),
    "utf8",
  );
  assert.equal(/\bdebugger\b/.test(source), false);
  assert.equal(source.includes("clipboardData.getData"), false);
  assert.equal(source.includes("event.key,"), false);
  assert.equal(source.includes("innerHTML"), false);
});

test("fullscreen changes are reported to the hard exam gate", async () => {
  const source = await readFile(
    new URL("../src/lib/use-exam-deterrents.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /onFullscreenChange\(active\)/);
  assert.match(source, /active \? "fullscreen_enter" : "fullscreen_exit"/);
});

test("pre-opened developer tools trigger a reversible hard gate", async () => {
  const deterrents = await readFile(
    new URL("../src/lib/use-exam-deterrents.ts", import.meta.url),
    "utf8",
  );
  const runner = await readFile(
    new URL("../src/app/exam/[examId]/ExamRunner.tsx", import.meta.url),
    "utf8",
  );
  assert.match(deterrents, /inspectDimensions\(\);/);
  assert.match(deterrents, /consecutiveDimensionSignals >= 2/);
  assert.match(deterrents, /consecutiveCleanDimensionSignals >= 2/);
  assert.match(deterrents, /onDevToolsChange\(true\)/);
  assert.match(deterrents, /onDevToolsChange\(false\)/);
  assert.match(runner, /Exam paused — close developer tools/);
  assert.match(runner, /devToolsPausedRef\.current/);
});
