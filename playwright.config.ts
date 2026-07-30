import { defineConfig } from "playwright/test";

/**
 * E2E gate (milestone 6, §9.1). Two layers:
 *  - `ui` project: React surface in isolation (Tauri runtime mocked) — runs anywhere.
 *  - `app` project: full app against the built executable with CAPTURE_SCREEN
 *    software rendering for stable screenshots — runs in the release pipeline
 *    on a Windows runner with WebView2. See docs/RELEASE.md.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: "http://localhost:1420",
    colorScheme: "dark",
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure",
    reducedMotion: "reduce",
  },
  projects: [
    {
      name: "ui",
      testMatch: "**/*.ui.spec.ts",
      use: {
        injectTauriMock: true,
      } as never,
    },
    {
      name: "app",
      testMatch: "**/*.app.spec.ts",
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:1420",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
