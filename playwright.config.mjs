import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: {
    timeout: 8_000,
  },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    channel:
      process.env.PLAYWRIGHT_CHANNEL ??
      (process.env.CI ? undefined : "msedge"),
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
  webServer: {
    command: "node apps/api/src/server.mjs",
    url: "http://127.0.0.1:3100/api/health",
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      PORT: "3100",
      DB_PATH: ":memory:",
      AUTH_SECRET: "playwright-only-secret",
    },
  },
});
