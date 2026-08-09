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

test("the attempt policy is announced before the learner can start", () => {
  // The readiness screen renders the typed policy notice ahead of the stepper
  // and the start button, so the learner sees the limits before acting.
  const readinessNotice = runner.lastIndexOf("<PolicyNotice");
  const startButton = runner.indexOf("Enter fullscreen and start");
  assert.ok(readinessNotice !== -1, "readiness screen must render PolicyNotice");
  assert.ok(startButton !== -1, "start button must exist");
  assert.ok(
    readinessNotice < startButton,
    "policy notice must render before the start button",
  );
  assert.match(runner, /exam\.attempt_statement && exam\.attempt_policy/);
});

test("the negative-marking rule is visible before the learner starts", () => {
  const scoringNotice = runner.indexOf("Correct: +1. Wrong: -1. Blank or skipped: 0.");
  const startButton = runner.indexOf("Enter fullscreen and start");
  assert.ok(scoringNotice !== -1 && startButton !== -1);
  assert.ok(scoringNotice < startButton);
  assert.match(runner, /total can never fall below 0/);
});

test("a cooldown or exhausted attempt shows a blocked card instead of the start screen", () => {
  // The blocked branch is gated on the server-decision snapshot and returns
  // before the readiness screen is ever rendered.
  assert.match(runner, /return <PolicyBlockedCard exam=\{exam\} \/>/);
  assert.match(runner, /!exam\.attempt_policy\.can_start/);
  assert.match(runner, /reason_code === "cooldown" \|\|/);
  assert.match(runner, /reason_code === "exhausted"/);
  const blockedReturn = runner.indexOf("return <PolicyBlockedCard exam={exam} />");
  const readiness = runner.indexOf(
    "A short readiness check gives you one clear road into the exam.",
  );
  assert.ok(blockedReturn !== -1 && readiness !== -1);
  assert.ok(blockedReturn < readiness, "blocked card must short-circuit the readiness screen");
});

test("blocked and exhausted screens expose attempts used, remaining, and next eligible time", () => {
  assert.match(runner, /Used \{policy\.attempts_used\} of \{policy\.max_attempts\} attempts/);
  assert.match(runner, /policy\.attempts_remaining\} remaining/);
  assert.match(runner, /Next attempt eligible at/);
  assert.match(runner, /No attempts remain for this assessment\./);
  assert.match(runner, /This attempt is not available yet/);
  assert.match(runner, /Return to UnivAI to start this exam when it becomes eligible\./);
});
