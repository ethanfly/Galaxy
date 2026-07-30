// Visual/regression suite executed in the release pipeline (§9.1): desktop &
// minimum window sizes, 100%/150%/200% scaling, zh/en — driven with
// CAPTURE_SCREEN=1 software rendering for stable screenshots.
// Skipped locally unless GALAXY_APP_E2E=1 and the app is launched by the
// pipeline harness (see docs/RELEASE.md §visual).
import { test, expect } from "playwright/test";

const enabled = process.env.GALAXY_APP_E2E === "1";

test.skip(!enabled, "visual regression runs in the release pipeline");

test.describe("visual baselines", () => {
  const sizes: Array<[number, number]> = [
    [1440, 900],
    [800, 520], // minimum supported window size
  ];

  for (const [w, h] of sizes) {
    test(`window ${w}x${h}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.goto("/");
      await expect(page.locator(".titlebar")).toBeVisible();
      await expect(page).toHaveScreenshot(`shell-${w}x${h}.png`, { maxDiffPixelRatio: 0.02 });
    });
  }
});
