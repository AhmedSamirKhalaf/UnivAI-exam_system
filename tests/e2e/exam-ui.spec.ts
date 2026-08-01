import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3200";
const studentId = "64b000000000000000000001";
const devToken = createHmac("sha256", process.env.UNIVAI_STANDALONE_SECRET ?? "univai-exam-local-development-only")
  .update(studentId)
  .digest("hex");
const attemptToken = process.env.EVIDENCE_ATTEMPT_TOKEN;
const examUrl = (examId: string) => attemptToken
  ? `${baseUrl}/exam/${examId}#attempt_token=${encodeURIComponent(attemptToken)}`
  : `${baseUrl}/exam/${examId}?dev_token=${devToken}`;

test.describe.serial("premium exam UI evidence", () => {
  test("keyboard-ready desktop road reaches one active question", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(examUrl("64b000000000000000000022"));
    await expect(page.getByRole("heading", { name: "Active midterm" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Integrity and privacy")).toBeVisible();

    await page.screenshot({ path: "evidence/exam-ui/readiness-desktop.png", fullPage: true, animations: "disabled" });

    await page.keyboard.press("Tab");
    await expect(page.getByRole("checkbox")).toBeFocused();
    const outlineWidth = await page.getByRole("checkbox").locator("..").evaluate((element) => getComputedStyle(element).outlineWidth);
    expect(outlineWidth).toBe("3px");
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
});
