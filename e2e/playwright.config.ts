import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    { command: 'npx tsx harness.ts', cwd: '.', port: 8080, reuseExistingServer: !process.env.CI, env: { PORT: '8080' } },
    {
      command: 'npm run build -w client && npm run preview -w client -- --port 4173 --host 127.0.0.1',
      cwd: '..',
      port: 4173,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      env: { VITE_E2E: '1', VITE_API_URL: 'http://127.0.0.1:8080', VITE_WS_URL: 'ws://127.0.0.1:8080/ws' },
    },
  ],
})
