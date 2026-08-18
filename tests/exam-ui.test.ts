import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const theme = readFileSync("src/app/ExamThemeProvider.tsx", "utf8");
const runner = readFileSync("src/app/exam/[examId]/ExamRunner.tsx", "utf8");
const layout = readFileSync("src/app/layout.tsx", "utf8");
const proxy = readFileSync("src/proxy.ts", "utf8");

function luminance(hex: string): number {
  const channels = hex.match(/[0-9a-f]{2}/gi)?.map((value) => Number.parseInt(value, 16) / 255) ?? [];
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

test("exam presentation stays inside the MUI-only styling boundary", () => {
  const source = `${theme}\n${runner}\n${layout}`;
  assert.doesNotMatch(source, /\bsx\s*=/);
  assert.doesNotMatch(source, /\bstyled\s*\(/);
  assert.match(layout, /ExamThemeProvider locale=\{locale\}/);
});

test("theme tokens support AAA-oriented text contrast and visible boundaries", () => {
  const textPairs = [
    ["#172033", "#FFFFFF"],
    ["#44516A", "#FFFFFF"],
    ["#2847C7", "#FFFFFF"],
    ["#075A31", "#EAF8F0"],
    ["#6B3900", "#FFF4E5"],
    ["#8A1C13", "#FFF1F0"],
    ["#0E4691", "#EFF4FF"],
  ] as const;
  for (const [foreground, background] of textPairs) {
    assert.ok(contrast(foreground, background) >= 7, `${foreground}/${background} must reach 7:1`);
    assert.match(theme, new RegExp(foreground));
  }
  assert.ok(contrast("#512DA8", "#FFFFFF") >= 3);
  assert.ok(contrast("#667085", "#FFFFFF") >= 3);
  assert.match(theme, /outline: "3px solid #512DA8"/);
  assert.match(theme, /minHeight: 44/);
  assert.match(theme, /minWidth: 44/);
});

test("layout resolves language and direction and exposes a keyboard skip link", () => {
  assert.match(layout, /<html lang=\{locale\} dir=\{direction\}>/);
  assert.match(layout, /href="#main-content"/);
  assert.match(layout, /id="main-content" tabIndex=\{-1\}/);
  assert.match(theme, /exam-skip-link/);
  assert.match(proxy, /uiLocale/);
  assert.match(proxy, /searchParams\.get\("lang"\)/);
  assert.match(proxy, /response\.cookies\.set/);
});

test("MUI has a locale direction and an RTL Emotion cache", () => {
  assert.match(theme, /direction: examDirection\(locale\)/);
  assert.match(theme, /stylisPlugins: \[prefixer, rtlPlugin\]/);
  assert.match(theme, /key: "mui-rtl"/);
});

test("motion follows the system preference and collapses for reduced motion", () => {
  assert.match(theme, /reducedMotion: "system"/);
  assert.match(theme, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(theme, /transitionDuration: "0\.01ms !important"/);
  assert.match(theme, /animationIterationCount: "1 !important"/);
});

test("generated exam content preserves its authored language and direction", () => {
  const authoredIslands = runner.match(/dir="auto"/g) ?? [];
  assert.ok(authoredIslands.length >= 4, "title, prompt, and option states need authored-language islands");
  assert.match(runner, /className="exam-generated-content"/);
  assert.doesNotMatch(runner, /lang="en"/);
  assert.match(runner, /\{exam\.title\}/);
  assert.match(runner, /\{question\.prompt\}/);
  assert.match(runner, /\{option\}/);
  assert.doesNotMatch(runner, /generated_questions|correct_option/);
});

test("guided exam road includes localized status, confirmation, and policy states", () => {
  assert.match(runner, /<Stepper/);
  assert.match(runner, /role="status"/);
  assert.match(runner, /role="alert"/);
  assert.match(runner, /t\("submitExamQuestion"\)/);
  assert.match(runner, /t\("requestReview"\)/);
  assert.match(runner, /localizePolicyStatement/);
  assert.match(runner, /localizeServerMessage/);
});

test("fullscreen and developer-tools signals hard-pause every exam action", () => {
  assert.match(runner, /t\("examPausedFullscreen"\)/);
  assert.match(runner, /t\("examPausedDeveloperTools"\)/);
  assert.match(runner, /fullscreenPausedRef\.current/);
  assert.match(runner, /devToolsPausedRef\.current/);
  assert.match(runner, /!document\.fullscreenElement/);
  assert.match(runner, /disabled=\{devToolsPaused\}/);
});

test("attempt policy and scoring appear before the start action", () => {
  const readinessPolicy = runner.lastIndexOf("<PolicyNotice");
  const scoringRule = runner.indexOf('t("knowMcqScoringDetail")');
  const startAction = runner.indexOf('t("enterFullscreenAndStart")');
  assert.ok(readinessPolicy !== -1 && scoringRule !== -1 && startAction !== -1);
  assert.ok(readinessPolicy < startAction);
  assert.ok(scoringRule < startAction);
  assert.match(runner, /return <PolicyBlockedCard exam=\{exam\} \/>/);
  assert.match(runner, /reason_code === "cooldown" \|\|/);
  assert.match(runner, /reason_code === "exhausted"/);
});
