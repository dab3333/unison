import { defineConfig, devices } from '@playwright/test'

// Ports can be moved (E2E_WEB_PORT / E2E_API_PORT) so the suite can run next to a real dev setup on 4173 / 8090.
// The harness only allows browser origins on 4173 and 5173, so use one of those for E2E_WEB_PORT.
const WEB = process.env.E2E_WEB_PORT ?? '4173'
const API = process.env.E2E_API_PORT ?? '8080'

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${WEB}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    { command: 'npx tsx harness.ts', cwd: '.', port: Number(API), reuseExistingServer: !process.env.CI, env: { PORT: API } },
    {
      command: `npm run build -w client && npm run preview -w client -- --port ${WEB} --host 127.0.0.1`,
      cwd: '..',
      port: Number(WEB),
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      env: { VITE_E2E: '1', VITE_API_URL: `http://127.0.0.1:${API}`, VITE_WS_URL: `ws://127.0.0.1:${API}/ws` },
    },
  ],
})
