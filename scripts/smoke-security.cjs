const { chromium } = require('playwright')
const assert = require('node:assert/strict')

async function main() {
  const base = process.env.SMOKE_BASE_URL || 'http://host.docker.internal'
  const browser = await chromium.launch({ args: ['--no-sandbox'] })
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    const response = await page.goto(`${base}/login`)
    assert(response.headers()['content-security-policy'].includes("frame-ancestors 'none'"))
    assert.equal(response.headers()['x-content-type-options'], 'nosniff')
    await page.getByPlaceholder('you@company.com or your username').fill(process.env.SMOKE_USERNAME)
    await page.locator('input[type=password]').fill(process.env.SMOKE_PASSWORD)
    await Promise.all([page.waitForURL('**/dashboard'), page.getByRole('button', { name: 'Sign in', exact: true }).click()])
    for (const route of ['/trash', '/notifications', '/settings', '/reports', '/system-guide']) {
      await page.goto(base + route)
      await page.getByRole('button', { name: 'Account menu', exact: true }).waitFor()
      await page.waitForTimeout(700)
      assert((await page.locator('main').innerText()).length > 20, `${route} rendered`)
      assert(!page.url().endsWith('/login'))
    }
    assert.deepEqual(errors, [])
    console.log('SMOKE_OK: headers, Trash, notifications, settings, reports and guide render without React errors')
  } finally { await browser.close() }
}
main().catch(e => { console.error(e); process.exit(1) })
