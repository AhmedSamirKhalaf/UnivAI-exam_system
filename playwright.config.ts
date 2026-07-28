import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30000,
  retries: 1,
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3200",
    extraHTTPHeaders: {
      "x-univai-dev-token": process.env.DEV_TOKEN || "dev-placeholder-token",
    },
  },
});
