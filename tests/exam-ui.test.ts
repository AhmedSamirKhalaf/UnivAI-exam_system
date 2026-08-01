import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const theme = readFileSync("src/app/ExamThemeProvider.tsx", "utf8");
const runner = readFileSync("src/app/exam/[examId]/ExamRunner.tsx", "utf8");
const layout = readFileSync("src/app/layout.tsx", "utf8");

test("exam presentation stays inside the MUI-only styling boundary", () => {
  const source = `${theme}\n${runner}\n${layout}`;
  assert.doesNotMatch(source, /\bsx\s*=/);
  assert.doesNotMatch(source, /\bstyled\s*\(/);
  assert.match(layout, /ExamThemeProvider/);
});

test("theme contains the reviewed palette, focus, and reduced-motion policy", () => {
  for (const color of ["#172033", "#526079", "#2847C7", "#0B6B3A", "#8A4B00", "#B42318", "#175CD3", "#7F56D9"]) {
    assert.match(theme, new RegExp(color));
  }
  assert.match(theme, /reducedMotion:\s*"system"/);
  assert.match(theme, /enteringScreen:\s*225/);
  assert.match(theme, /leavingScreen:\s*195/);
  assert.match(theme, /outline:\s*"3px solid #7F56D9"/);
});

test("guided exam road includes accessible status and confirmation states", () => {
  assert.match(runner, /<Stepper/);
  assert.match(runner, /timeout=\{\{ enter: 225, exit: 195 \}\}/);
  assert.match(runner, /role="status"/);
  assert.match(runner, /role="alert"/);
  assert.match(runner, /Submit this exam\?/);
  assert.match(runner, /Request review or appeal/);
  assert.doesNotMatch(runner, /generated_questions|correct_option/);
});

test("leaving fullscreen hard-pauses every exam action", () => {
  assert.match(runner, /Exam paused — fullscreen required/);
  assert.match(runner, /Return to fullscreen/);
  assert.match(runner, /fullscreenPausedRef\.current/);
  assert.match(runner, /!document\.fullscreenElement/);
  assert.match(runner, /onFullscreenChange\(false\)/);
  assert.doesNotMatch(runner, /The exam can continue/);
});

test("a repeated developer-tools dimension signal hard-pauses every exam action", () => {
  assert.match(runner, /Exam paused — close developer tools/);
  assert.match(runner, /devToolsPausedRef\.current/);
  assert.match(runner, /disabled=\{devToolsPaused\}/);
});
