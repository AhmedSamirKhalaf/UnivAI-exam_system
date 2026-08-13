import { createHmac } from "node:crypto";
import { expect, test, type Locator } from "@playwright/test";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3200";
const studentId = "64b000000000000000000001";
const devToken = createHmac("sha256", process.env.UNIVAI_STANDALONE_SECRET ?? "univai-exam-local-development-only")
  .update(studentId)
  .digest("hex");
const attemptToken = process.env.EVIDENCE_ATTEMPT_TOKEN;
const examUrl = (
  examId: string,
  locale?: "en" | "ar",
) => {
  const url = new URL(`/exam/${examId}`, baseUrl);
  if (locale) url.searchParams.set("uiLocale", locale);
  if (attemptToken) {
    url.hash = new URLSearchParams({ attempt_token: attemptToken }).toString();
  } else {
    url.searchParams.set("dev_token", devToken);
  }
  return url.toString();
};

async function expectMinimumTarget(
  locator: Locator,
) {
  const box = await locator.boundingBox();
  expect(box, "control must have a rendered box").not.toBeNull();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);
}

function durationToMilliseconds(duration: string): number {
  const token = duration.split(",", 1)[0]?.trim() ?? "";
  if (token.endsWith("ms")) return Number.parseFloat(token);
  if (token.endsWith("s")) return Number.parseFloat(token) * 1_000;
  return Number.NaN;
}

test.describe.serial("premium exam UI evidence", () => {
  test("keyboard-ready desktop road reaches one active question", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(examUrl("64b000000000000000000022"));
    await expect(page.getByRole("heading", { name: "Active midterm" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Integrity and privacy")).toBeVisible();

    await page.screenshot({ path: "evidence/exam-ui/readiness-desktop.png", fullPage: true, animations: "disabled" });

    await page.keyboard.press("Tab");
    const skipLink = page.getByRole("link", { name: "Skip to main content" });
    await expect(skipLink).toBeFocused();
    await expectMinimumTarget(skipLink);
    expect(await skipLink.evaluate((element) => getComputedStyle(element).outlineWidth)).toBe("3px");
    await page.keyboard.press("Enter");
    await expect(page.locator("main#main-content")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("checkbox")).toBeFocused();
    const outlineWidth = await page.getByRole("checkbox").locator("..").evaluate((element) => getComputedStyle(element).outlineWidth);
    expect(outlineWidth).toBe("3px");
    await expectMinimumTarget(page.getByRole("checkbox").locator(".."));
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Continue to readiness" }).click();
    await page.getByRole("button", { name: "Enter fullscreen and start" }).click();
    await expect(page.getByText("Secure connection active")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: /Standalone question 1/ })).toBeVisible();

    await page.screenshot({ path: "evidence/exam-ui/current-question-desktop.png", fullPage: true, animations: "disabled" });
  });

  test("submitted result is readable on a phone with reduced motion", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(examUrl("64b000000000000000000023"));
    await expect(page.getByText("Passed")).toBeVisible();
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    const motionDurations = await page.locator("main").evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        animationDuration: style.animationDuration,
        animationIterationCount: style.animationIterationCount,
        transitionDuration: style.transitionDuration,
      };
    });
    expect(durationToMilliseconds(motionDurations.animationDuration)).toBeLessThanOrEqual(0.1);
    expect(motionDurations.animationIterationCount).toBe("1");
    expect(durationToMilliseconds(motionDurations.transitionDuration)).toBeLessThanOrEqual(0.1);
    await page.screenshot({ path: "evidence/exam-ui/submitted-mobile-reduced-motion.png", fullPage: true, animations: "disabled" });
  });

  test("integrity review uses factual language and exposes the appeal entry", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(examUrl("64b000000000000000000025"));
    await expect(page.getByText("Result held for integrity review")).toBeVisible();
    await expect(page.getByRole("link", { name: "Request review or appeal" })).toBeVisible();
    await expect(page.getByText(/not an automatic claim/i)).toBeVisible();
    await page.screenshot({ path: "evidence/exam-ui/integrity-review-desktop.png", fullPage: true, animations: "disabled" });
  });

  test("Arabic shell persists while generated exam content stays English LTR", async ({ page, context }) => {
    await context.addCookies([{ name: "univai_ui_locale", value: "en", url: baseUrl }]);
    const response = await page.goto(examUrl("64b000000000000000000022", "ar"));
    const html = await response?.text();
    expect(html).toContain('<html lang="ar" dir="rtl"');
    await expect(page.getByText("النزاهة والخصوصية")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Active midterm" })).toBeVisible();
    await expect(page.locator('h1[lang="en"][dir="ltr"]', { hasText: "Active midterm" })).toBeVisible();

    const localeCookie = (await context.cookies()).find((cookie) => cookie.name === "univai_ui_locale");
    expect(localeCookie?.value).toBe("ar");

    await page.reload();
    await expect(page.getByText("النزاهة والخصوصية")).toBeVisible();

    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "المتابعة إلى فحص الاستعداد" }).click();
    await page.getByRole("button", { name: "الدخول إلى ملء الشاشة والبدء" }).click();
    await expect(page.getByText("الاتصال الآمن نشط")).toBeVisible({ timeout: 15_000 });
    const prompt = page.locator('h2[lang="en"][dir="ltr"]');
    await expect(prompt).toContainText("Standalone question 1");
    const option = page.locator('.exam-generated-content[lang="en"][dir="ltr"]').filter({ hasText: /^A\)/ }).first();
    await expect(option).toBeVisible();
    expect(await prompt.evaluate((element) => getComputedStyle(element).direction)).toBe("ltr");
    expect(await option.evaluate((element) => getComputedStyle(element).direction)).toBe("ltr");
  });
});
