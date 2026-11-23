import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:4173' },
  // Chromium = Chrome/Edge/Windows desktop (WebView2); WebKit = Safari/macOS desktop (WKWebView)
  projects: [
    // PW_CHROMIUM_CHANNEL=chrome runs on the installed Google Chrome instead of downloading Playwright's Chromium
    { name: 'chromium', use: { ...devices['Desktop Chrome'], channel: process.env.PW_CHROMIUM_CHANNEL } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: { command: 'pnpm build && pnpm preview', url: 'http://localhost:4173', reuseExistingServer: !process.env.CI },
});
