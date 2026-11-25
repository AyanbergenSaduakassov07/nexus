// Browser check of the seeded demo: asserts key numbers, fails on console errors,
// and writes the README screenshots. Needs the stack running, demo/seed.py and pipelines/run_dbt.sh loaded.
// Usage: node e2e/browser.mjs [--out ../../docs/images] [--base http://127.0.0.1:13000]
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'

const { values } = parseArgs({ options: { out: { type: 'string', default: 'screenshots' }, base: { type: 'string', default: 'http://127.0.0.1:13000' } } })
const DESKTOP = { width: 1440, height: 1290 }
const PHONE = { width: 390, height: 844 }
const LINEAGE = '#lineage?kind=job&namespace=ingestion&name=extract_payments'
const COLUMNS = '#lineage?kind=dataset&namespace=reporting&name=report.monthly_revenue'
const QUALITY = `#lineage?kind=dataset&namespace=${encodeURIComponent('duckdb://jaffle_shop.duckdb')}&name=jaffle_shop.main.customers`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: DESKTOP, deviceScaleFactor: 2, locale: 'en-US', timezoneId: 'UTC' })
const errors = []
page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
page.on('pageerror', (error) => errors.push(error.message))

async function open(hash) {
  await page.goto(`${values.base}/${hash}`)
  await page.locator('#content[aria-busy="false"]').waitFor()
}

async function setLang(lang) {
  await page.click(`[data-lang="${lang}"]`)
  await page.locator(`html[lang="${lang}"]`).waitFor()
  await page.locator('#content[aria-busy="false"]').waitFor()
}

async function fitLineage() {
  const fit = page.locator('.btn[aria-pressed]')
  if ((await fit.getAttribute('aria-pressed')) !== 'true') await fit.click()
}

const shot = async (name) => {
  await page.evaluate(() => document.activeElement?.blur())
  await page.screenshot({ path: `${values.out}/${name}.png` })
}
const kpis = async () => page.locator('.kpi strong').allInnerTexts()

try {
  await mkdir(values.out, { recursive: true })
  await open('#overview')
  await setLang('en')
  const [jobs, datasets, failing] = await kpis()
  assert.deepEqual([jobs, datasets, failing], ['26', '24', '2'], 'overview KPIs: Olist demo + dbt jaffle_shop')
  await shot('overview-en')

  await open('#jobs')
  assert.equal(await page.locator('tbody tr').count(), 20, 'jobs table rows (first page)')
  await shot('jobs-en')

  await open(LINEAGE)
  await fitLineage()
  const stats = await page.locator('.stats strong').allInnerTexts()
  assert.deepEqual(stats.slice(0, 3), ['0', '9', '2'], 'extract_payments upstream, downstream, outputs at risk')
  await shot('lineage-en')

  await open(QUALITY)
  await fitLineage()
  assert.ok((await page.locator('h2').allInnerTexts()).includes('Data quality checks · 2/3'), 'dbt test results panel')
  assert.equal(await page.locator('td .status.warn').count(), 1, 'one advisory dbt test failure')
  await shot('quality-en')

  await open(COLUMNS)
  assert.match(await page.locator('.asset-head .owner').innerText(), /team:finance/, 'owner from the ownership facet')
  // Stale vs fresh depends on the hour the seed ran, so only the SLA text is asserted.
  assert.match(await page.locator('.asset-head .status').innerText(), /SLA 24h/, 'freshness SLA chip')
  assert.ok((await page.locator('h2').allInnerTexts()).includes('Column lineage · 4'), 'column lineage panel')
  assert.equal(await page.locator('.sources a').count(), 5, 'column sources link to their datasets')
  await page.locator('section.panel', { has: page.locator('h2', { hasText: 'Column lineage' }) })
    .screenshot({ path: `${values.out}/columns-en.png` })

  await open(LINEAGE)
  await setLang('ru')
  await fitLineage()
  assert.match(await page.locator('.asset-head').innerText(), /сбой/, 'RU status label')
  await shot('lineage-ru')

  await open('#overview')
  await shot('overview-ru')

  await setLang('en')
  await page.setViewportSize(PHONE)
  const width = await page.evaluate(() => document.documentElement.scrollWidth)
  assert.equal(width, PHONE.width, 'no horizontal scroll at phone width')
  await shot('mobile-en')

  assert.deepEqual(errors, [], 'console errors')
  console.info(`Browser check passed; screenshots in ${values.out}`)
} finally {
  await browser.close()
}
