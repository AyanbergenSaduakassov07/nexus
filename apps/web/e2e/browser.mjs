// Browser check of the seeded demo: asserts key numbers, fails on console errors,
// and writes the README screenshots. Needs the stack running and demo/seed.py loaded.
// Usage: node e2e/browser.mjs [--out ../../docs/images] [--base http://127.0.0.1:13000]
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'

const { values } = parseArgs({ options: { out: { type: 'string', default: 'screenshots' }, base: { type: 'string', default: 'http://127.0.0.1:13000' } } })
const DESKTOP = { width: 1440, height: 1290 }
const PHONE = { width: 390, height: 844 }
const LINEAGE = '#lineage?kind=job&namespace=ingestion&name=extract_payments'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: DESKTOP, locale: 'en-US', timezoneId: 'UTC' })
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
  assert.deepEqual([jobs, datasets, failing], ['15', '19', '2'], 'overview KPIs')
  await shot('overview-en')

  await open('#jobs')
  assert.equal(await page.locator('tbody tr').count(), 15, 'jobs table rows')
  await shot('jobs-en')

  await open(LINEAGE)
  await fitLineage()
  const stats = await page.locator('.stats strong').allInnerTexts()
  assert.deepEqual(stats.slice(0, 3), ['0', '9', '2'], 'extract_payments upstream, downstream, outputs at risk')
  await shot('lineage-en')

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
