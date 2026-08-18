import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getRestrictedShortcut } from "../src/lib/proctoring-signals";

const base = {
  code: "",
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

test("main-thread deterrents have no pause trap or sensitive payload collection", async () => {
  const source = await readFile(
    new URL("../src/lib/use-exam-deterrents.ts", import.meta.url),
    "utf8",
  );
  assert.equal(/\bdebugger\b/.test(source), false);
  assert.equal(source.includes("clipboardData.getData"), false);
  assert.equal(source.includes("event.key,"), false);
  assert.equal(source.includes("innerHTML"), false);
});

test("restricted shortcuts use physical keys on non-Latin keyboard layouts", () => {
  assert.equal(
    getRestrictedShortcut({ ...base, key: "ه", code: "KeyI", ctrlKey: true, shiftKey: true }),
    "Ctrl+Shift+I",
  );
  assert.equal(
    getRestrictedShortcut({ ...base, key: "ت", code: "KeyJ", ctrlKey: true, shiftKey: true }),
    "Ctrl+Shift+J",
  );
  assert.equal(
    getRestrictedShortcut({ ...base, key: "ؤ", code: "KeyC", ctrlKey: true, shiftKey: true }),
    "Ctrl+Shift+C",
  );
});

test("a main-page IIFE repeatedly pauses when an inspector is listening", async () => {
  const script = await readFile(
    new URL("../public/exam-debug-deterrent.js", import.meta.url),
    "utf8",
  );
  const deterrents = await readFile(
    new URL("../src/lib/use-exam-deterrents.ts", import.meta.url),
    "utf8",
  );
  const loader = await readFile(
    new URL("../src/lib/devtools-deterrent.ts", import.meta.url),
    "utf8",
  );
  const channel = await readFile(
    new URL("../src/lib/use-exam-integrity-channel.ts", import.meta.url),
    "utf8",
  );
  const socket = await readFile(
    new URL("../src/lib/integrity-socket.ts", import.meta.url),
    "utf8",
  );
  assert.match(script, /^\(\(\) => \{/);
  assert.match(script, /\bdebugger;/);
  assert.match(script, /: 50;/);
  assert.match(script, /state\.intervalMs/);
  assert.match(script, /window\.addEventListener\(stopEventName, stop\)/);
  assert.match(loader, /EXAM_DEBUG_PROBE_INTERVAL_MS = 50/);
  assert.match(loader, /document\.createElement\("script"\)/);
  assert.match(deterrents, /ensureExamDebugDeterrent/);
  assert.match(channel, /message\.type === "deterrent_ensure"/);
  assert.match(channel, /ensureExamDebugDeterrent/);
  assert.match(socket, /type: "deterrent_ensure"/);
  assert.match(socket, /setInterval\(\(\) => issueDeterrentEnsure\(socket\), 500\)/);
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
  assert.match(runner, /t\("examPausedDeveloperTools"\)/);
  assert.match(runner, /devToolsPausedRef\.current/);
});
