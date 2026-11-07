import { defineConfig } from '@playwright/test'

/**
 * Browser tests against `next start` (run `pnpm --filter @blueyvatar/web build` first). The app talks to a
 * Postgres database (E2E_DATABASE_URL or TEST_DATABASE_URL, migrated with `pnpm db:migrate`) and to a stub
 * delivery server that e2e/global-setup.ts starts. No Resend key and no PDS are configured, so nothing
 * leaves the machine. PW_CHROMIUM_PATH points at an installed Chromium when the bundled one is absent.
 */
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3100)
export const STUB_PORT = Number(process.env.E2E_STUB_PORT ?? 3101)
const base = `http://localhost:${WEB_PORT}`
const database = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.spec.ts',
  globalSetup: './e2e/global-setup.ts',
  // The report limit test counts submissions per client address, and each test uses its own address.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  use: {
    baseURL: base,
    trace: 'off',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: {
    command: 'node_modules/.bin/next start -p ' + WEB_PORT,
    url: `${base}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      NODE_ENV: 'production',
      E2E_HARNESS: '1',
      PUBLIC_URL: base,
      DELIVERY_URL: `http://127.0.0.1:${STUB_PORT}`,
      ...(database ? { DATABASE_URL: database } : {}),
      SESSION_SECRET: 'e2e-session-secret-not-for-production',
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      REPORT_IP_SECRET: 'e2e-report-secret',
      RESEND_API_KEY: '',
      SENTRY_DSN: '',
    },
  },
})
