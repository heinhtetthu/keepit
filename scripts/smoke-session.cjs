// Run in the Playwright Docker image; credentials come from the environment.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')

async function main() {
  const base = process.env.SMOKE_BASE_URL || 'http://host.docker.internal'
  assert(process.env.SMOKE_USERNAME && process.env.SMOKE_PASSWORD, 'Smoke credentials are required')
  // Treat Docker's localhost alias as trustworthy for the Web Locks check.
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', `--unsafely-treat-insecure-origin-as-secure=${base}`] })
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    const crashes = []
    page.on('pageerror', error => crashes.push(error.message))
    await page.goto(`${base}/login`)
    await page.getByPlaceholder('you@company.com or your username').fill(process.env.SMOKE_USERNAME)
    await page.locator('input[type="password"]').fill(process.env.SMOKE_PASSWORD)
    await Promise.all([
      page.waitForURL('**/dashboard', { timeout: 30000 }),
      page.getByRole('button', { name: 'Sign in', exact: true }).click(),
    ])
    await page.getByRole('button', { name: 'Account menu', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => localStorage.getItem('refresh_token')), null)
    const cookie = (await context.cookies()).find(c => c.name === 'renewly_refresh')
    assert(cookie && cookie.httpOnly && cookie.sameSite === 'Strict')
    const oldToken = await page.evaluate(() => localStorage.getItem('access_token'))

    // Invalid access credentials must transparently refresh using the HttpOnly cookie.
    await page.evaluate(() => localStorage.setItem('access_token', 'expired-smoke-token'))
    const refresh = page.waitForResponse(r => r.url().endsWith('/api/v1/auth/refresh') && r.status() === 200)
    await page.reload()
    await refresh
    await page.getByRole('button', { name: 'Account menu', exact: true }).waitFor()
    assert.notEqual(await page.evaluate(() => localStorage.getItem('access_token')), 'expired-smoke-token')

    // The same browser session can recover concurrent requests in two tabs.
    const second = await context.newPage()
    await second.goto(`${base}/dashboard`)
    await second.getByRole('button', { name: 'Account menu', exact: true }).waitFor()
    await page.evaluate(() => localStorage.setItem('access_token', 'expired-two-tab-token'))
    await Promise.all([page.reload(), second.reload()])
    for (let attempt = 0; attempt < 50; attempt++) {
      const current = await page.evaluate(() => localStorage.getItem('access_token'))
      if (current && current !== 'expired-two-tab-token') break
      await page.waitForTimeout(100)
    }
    await Promise.all([page, second].map(p => p.getByRole('button', { name: 'Account menu', exact: true }).waitFor()))
    assert.notEqual(await page.evaluate(() => localStorage.getItem('access_token')), 'expired-two-tab-token')

    await page.getByRole('button', { name: 'Account menu', exact: true }).click()
    await Promise.all([
      page.waitForURL('**/login'),
      page.getByRole('button', { name: 'Sign out', exact: true }).click(),
    ])
    assert.equal(await page.evaluate(() => localStorage.getItem('access_token')), null)
    assert(!(await context.cookies()).some(c => c.name === 'renewly_refresh'))
    const revoked = await context.request.get(`${base}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${oldToken}` },
    })
    assert.equal(revoked.status(), 401)
    assert.deepEqual(crashes, [])
    console.log('SMOKE_OK: login, cookie refresh, two-tab refresh, logout, and token revocation')
  } finally {
    await browser.close()
  }
}
main().catch(error => { console.error(error.stack); process.exit(1) })
