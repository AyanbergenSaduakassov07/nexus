import { durationChart, lineageGraph, runStrip, runsChart } from './charts.js'
import { lang, setLang, stateLabel, t, translateDocument } from './i18n.js'
import { HEALTH_RUNS, blastRadius, dailyOutcomes, edgesOf, fitLabel, healthBand, healthScore, isFailed, nodeRef, quality, reachable, shortName, toMermaid, uniqueEvents }
  from './model.js'

const PAGE_SIZE = 20
// Marquez 0.51 attaches facets (quality checks) to the first 10 datasets of a page only.
const DATASET_PAGE = 10
const LIST_PAGE = 100
const MAX_JOBS = 500
const LINEAGE_DEPTH = 20
const MAX_INCIDENTS = 5
const main = document.querySelector('main')
const content = document.querySelector('#content')
const title = document.querySelector('#page-title')
const subtitle = document.querySelector('#page-subtitle')
const connection = document.querySelector('#connection')
const navLinks = document.querySelectorAll('.sidebar nav a, .about-link')
const searchBox = document.querySelector('#search')

let activeRequest

// ---------- DOM helpers ----------
function element(tag, className, ...children) {
  const node = document.createElement(tag)
  if (className) node.className = className
  node.append(...children.filter((child) => child !== null && child !== undefined && child !== false))
  return node
}

function href(page, params = {}) {
  const query = new URLSearchParams(params).toString()
  return query ? `#${page}?${query}` : `#${page}`
}

function link(label, page, params, className = 'record-link') {
  const anchor = element('a', className, label)
  anchor.href = href(page, params)
  return anchor
}

function text(value, fallback = '—') {
  return typeof value === 'string' && value ? value : fallback
}

const numbers = () => new Intl.NumberFormat(lang)
const date = (value) => {
  const stamp = new Date(text(value, ''))
  return Number.isNaN(stamp.getTime()) ? '—'
    : new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(stamp)
}

function duration(ms) {
  if (!Number.isFinite(ms)) return '—'
  return ms >= 60_000 ? `${(ms / 60_000).toFixed(1)} ${t('unit.min')}` : `${Math.round(ms / 1000)} ${t('unit.s')}`
}

function status(value) {
  const label = text(value, 'UNKNOWN')
  const tone = { COMPLETED: 'ok', COMPLETE: 'ok', FAILED: 'bad', FAIL: 'bad', ABORT: 'bad', ABORTED: 'bad',
    RUNNING: 'active', START: 'active' }[label] ?? 'neutral'
  return element('span', `status ${tone}`, stateLabel(label))
}

function healthPill(score) {
  const band = healthBand(score)
  const pill = element('span', `health ${band}`, score === null ? '—' : String(score))
  pill.title = t(`health.${band}`)
  return pill
}

function checksPill(result) {
  if (!result) return element('span', 'status neutral', '—')
  const tone = result.blocking ? 'bad' : result.failed.length ? 'warn' : 'ok'
  // Tone label in the text itself, not only colour + title, so screen readers and touch get it.
  const pill = element('span', `status ${tone}`, `${result.passed}/${result.assertions.length}`)
  pill.title = t(`quality.${tone}`)
  pill.setAttribute('aria-label', `${result.passed}/${result.assertions.length} · ${t(`quality.${tone}`)}`)
  pill.setAttribute('role', 'img')
  return pill
}

function qualityPanel(result) {
  if (!result) return null
  const outcome = (a) => a.success !== false ? 'ok' : a.severity === 'warn' ? 'warn' : 'bad'
  return section(`${t('quality.title')} · ${result.passed}/${result.assertions.length}`,
    table([t('quality.check'), t('quality.column'), t('quality.result'), t('quality.failing')],
      result.assertions.map((a) => [element('code', '', text(a.name ?? a.assertion)), text(a.column),
        element('span', `status ${outcome(a)}`, t(`quality.${outcome(a)}`)), text(a.actual == null ? '' : String(a.actual))]), ''))
}

function section(heading, ...children) {
  return element('section', 'panel', heading ? element('h2', '', heading) : null, ...children)
}

function table(headers, rows, empty) {
  if (!rows.length) return element('p', 'empty', empty)
  const head = headers.map((heading) => Object.assign(element('th', '', heading), { scope: 'col' }))
  const body = rows.map((row) => element('tr', '', ...row.map((cell) => element('td', '', cell))))
  return element('div', 'table-scroll', element('table', '', element('thead', '', element('tr', '', ...head)),
    element('tbody', '', ...body)))
}

function pagination(page, offset, count, length, params = {}, size = PAGE_SIZE) {
  const nav = element('nav', 'pagination')
  nav.setAttribute('aria-label', t('page.label'))
  if (offset > 0) nav.append(link(t('page.previous'), page, { ...params, offset: Math.max(0, offset - size) }))
  nav.append(element('span', '', length
    ? `${offset + 1}–${offset + length} ${t('page.of')} ${numbers().format(count)}` : t('page.none')))
  if (offset + size < count) nav.append(link(t('page.next'), page, { ...params, offset: offset + size }))
  return nav
}

// ---------- API ----------
async function get(path, signal) {
  const response = await fetch(`/api/v1/${path}`, { signal })
  if (response.status === 404) throw new Error(t('error.notFound'))
  if (!response.ok) throw new Error(t('error.service'))
  const body = await response.json()
  if (!body || typeof body !== 'object') throw new Error(t('error.shape'))
  return body
}

function records(body, key) {
  if (!Array.isArray(body[key])) throw new Error(t('error.shape'))
  return body[key].filter((record) => record && typeof record === 'object')
}

function total(body, rows) {
  return Number.isSafeInteger(body.totalCount) && body.totalCount >= rows.length ? body.totalCount : rows.length
}

async function listAll(path, key, signal, cap = MAX_JOBS) {
  const all = []
  for (let offset = 0; offset < cap; offset += LIST_PAGE) {
    const page = records(await get(`${path}${path.includes('?') ? '&' : '?'}limit=${LIST_PAGE}&offset=${offset}`, signal), key)
    all.push(...page)
    if (page.length < LIST_PAGE) break
  }
  return all
}

const visibleNamespaces = async (signal) =>
  (await listAll('namespaces', 'namespaces', signal)).filter((ns) => !ns.isHidden && text(ns.name, ''))

// The events API ignores hidden namespaces, so hide them here too.
// shortcut: scans the newest MAX_JOBS events only; add a server-side namespace filter if history matters.
async function recentEvents(signal) {
  const [events, namespaces] = await Promise.all([listAll('events/lineage', 'events', signal), visibleNamespaces(signal)])
  const visible = new Set(namespaces.map(({ name }) => name))
  return uniqueEvents(events.filter((event) => visible.has(event.job?.namespace)))
}

const nodeId = (kind, namespace, name) => `${kind}:${namespace}:${name}`
const lineageOf = async (id, signal) =>
  records(await get(`lineage?${new URLSearchParams({ nodeId: id, depth: LINEAGE_DEPTH })}`, signal), 'graph')

const nodeHref = (node) => href('lineage', nodeRef(node))

function nodeLink(node, className) {
  return link(shortName(node), 'lineage', nodeRef(node), className)
}

// dbt job names run to 60+ chars; show the distinguishing tail, keep the full name as a tooltip.
function lineageLink(kind, record, max = 40) {
  const name = text(record?.name, '')
  const namespace = text(record?.namespace, '')
  if (!name || !namespace) return text(name)
  const anchor = link(fitLabel(name, max), 'lineage', { kind, namespace, name })
  if (anchor.textContent !== name) { anchor.title = name; anchor.setAttribute('aria-label', name) }
  return anchor
}

// ---------- Overview ----------
function kpi(label, value, hint, tone = '', page) {
  const card = page ? link('', page, {}, `kpi ${tone}`) : element('div', `kpi ${tone}`)
  card.append(...[element('span', 'kpi-label', label), element('strong', '', value), hint && element('span', 'kpi-hint', hint)].filter(Boolean))
  return card
}

function incidentCard(job, radius, nodes) {
  const outputs = radius.outputs.map((id) => element('li', '', nodeLink(nodes.get(id) ?? id)))
  const chip = (count, label) => element('span', 'chip', `${label}: `, element('b', '', String(count)))
  return element('article', 'incident',
    element('div', 'incident-head', status(job.latestRun?.state), lineageLink('job', job),
      element('span', 'muted', `${text(job.namespace)} · ${date(job.latestRun?.endedAt ?? job.updatedAt)}`)),
    element('div', 'chips', element('span', 'chip-label', t('incidents.impact')),
      chip(radius.outputs.length, t('incidents.outputs')), chip(radius.jobs.length, t('incidents.jobs')),
      chip(radius.datasets.length, t('incidents.datasets'))),
    outputs.length ? element('ul', 'output-list', ...outputs) : null)
}

function healthBar(jobs, scores) {
  const bands = ['healthy', 'watch', 'risk', 'unknown']
  const counts = Object.fromEntries(bands.map((band) => [band, scores.filter((s) => healthBand(s) === band).length]))
  const bar = element('div', 'stack-bar', ...bands.filter((band) => counts[band]).map((band) => {
    const segment = element('span', `seg ${band}`)
    segment.style.flexGrow = String(counts[band])
    segment.title = `${t(`health.${band}`)}: ${counts[band]}`
    return segment
  }))
  const legend = element('ul', 'legend', ...bands.map((band) =>
    element('li', '', element('i', `swatch ${band}`), `${t(`health.${band}`)} `, element('b', '', String(counts[band])))))
  const lowest = jobs.map((job, i) => [job, scores[i]]).filter(([, s]) => s !== null && s < 85)
    .sort((a, b) => a[1] - b[1]).slice(0, 3)
  const attention = lowest.length ? [element('h3', 'mini-title', t('health.lowest')), element('ul', 'rank-list',
    ...lowest.map(([job, s]) => element('li', '', healthPill(s), lineageLink('job', job), runStrip(job.latestRuns))))] : []
  return [bar, legend, ...attention, element('p', 'footnote', t('health.explain'))]
}

async function overview({ signal }) {
  const [jobs, namespaces, eventPage] = await Promise.all([
    listAll('jobs', 'jobs', signal), visibleNamespaces(signal), recentEvents(signal)])
  const datasetCounts = await Promise.all(namespaces.map(async ({ name }) => {
    const body = await get(`namespaces/${encodeURIComponent(name)}/datasets?limit=1`, signal)
    return total(body, records(body, 'datasets'))
  }))
  const failing = jobs.filter((job) => isFailed(job.latestRun?.state))
  const incidents = await Promise.all(failing.slice(0, MAX_INCIDENTS).map(async (job) => {
    const id = nodeId('job', job.namespace, job.name)
    const graph = await lineageOf(id, signal)
    return incidentCard(job, blastRadius(edgesOf(graph), id), new Map(graph.map((node) => [node.id, node])))
  }))
  const scores = jobs.map((job) => healthScore(job.latestRuns))
  const scored = scores.filter((score) => score !== null)
  const average = scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null
  const events = eventPage.slice(0, 8)

  return element('div', 'dashboard',
    element('div', 'kpi-grid',
      kpi(t('kpi.jobs'), numbers().format(jobs.length), `${t('kpi.namespaces')}: ${namespaces.length}`, '', 'jobs'),
      kpi(t('kpi.datasets'), numbers().format(datasetCounts.reduce((a, b) => a + b, 0)), null, '', 'datasets'),
      kpi(t('kpi.failing'), String(failing.length), t('kpi.failingHint'), failing.length ? 'bad' : 'ok'),
      kpi(t('kpi.health'), average === null ? '—' : String(average), t('kpi.healthHint'), healthBand(average))),
    element('div', 'grid-2',
      section(t('incidents.title'), incidents.length ? element('div', 'incident-list', ...incidents)
        : element('p', 'empty ok-note', t('incidents.none'))),
      section(t('health.title'), ...healthBar(jobs, scores))),
    element('div', 'grid-2 wide-left',
      section(t('chart.runs'), runsChart(dailyOutcomes(jobs, HEALTH_RUNS)),
        element('ul', 'legend', element('li', '', element('i', 'swatch healthy'), t('chart.ok')),
          element('li', '', element('i', 'swatch risk'), t('chart.failed')))),
      section(t('activity.title'), eventTable(events, true))))
}

function eventTable(events, compact = false) {
  const headers = compact ? [t('col.job'), t('col.event')] : [t('col.job'), t('col.namespace'), t('col.event'), t('col.time')]
  return table(headers, events.map((event) => compact
    ? [lineageLink('job', event.job, 28), status(event.eventType)]
    : [lineageLink('job', event.job), text(event.job?.namespace), status(event.eventType), date(event.eventTime)]),
  t('empty.events'))
}

// ---------- Lists ----------
async function jobsPage({ signal, offset }) {
  const body = await get(`jobs?limit=${PAGE_SIZE}&offset=${offset}`, signal)
  const rows = records(body, 'jobs')
  return section(null, table(
    [t('col.job'), t('col.namespace'), t('col.health'), t('col.history'), t('col.lastRun'), t('col.duration'), t('col.updated')],
    rows.map((job) => [lineageLink('job', job), text(job.namespace), healthPill(healthScore(job.latestRuns)),
      runStrip(job.latestRuns), status(job.latestRun?.state), duration(job.latestRun?.durationMs), date(job.updatedAt)]),
    t('empty.jobs')), pagination('jobs', offset, total(body, rows), rows.length))
}

async function datasetsPage({ signal, offset, params }) {
  const names = (await visibleNamespaces(signal)).map(({ name }) => name).sort()
  const scope = params.get('namespace')
  const namespace = names.includes(scope) ? scope : names[0]
  if (!namespace) return section(null, element('p', 'empty', t('empty.namespaces')))
  const body = await get(`namespaces/${encodeURIComponent(namespace)}/datasets?limit=${DATASET_PAGE}&offset=${offset}`, signal)
  const rows = records(body, 'datasets')
  const select = element('select', '', ...names.map((name) => Object.assign(element('option', '', name), { value: name })))
  select.id = 'dataset-namespace'
  select.value = namespace
  select.addEventListener('change', () => { location.hash = href('datasets', { namespace: select.value }) })
  const label = Object.assign(element('label', '', t('filter.namespace')), { htmlFor: select.id })
  return section(null, element('div', 'filter', label, select),
    table([t('col.dataset'), t('col.type'), t('col.fields'), t('col.checks'), t('col.updated')], rows.map((dataset) => [
      lineageLink('dataset', dataset), text(dataset.type),
      Array.isArray(dataset.fields) ? String(dataset.fields.length) : '—', checksPill(quality(dataset)), date(dataset.updatedAt)]),
    t('empty.datasets')), pagination('datasets', offset, total(body, rows), rows.length, { namespace }, DATASET_PAGE))
}

async function eventsPage({ signal, offset }) {
  const events = await recentEvents(signal)
  const rows = events.slice(offset, offset + PAGE_SIZE)
  return section(null, eventTable(rows), pagination('events', offset, events.length, rows.length))
}

async function searchPage({ signal, params }) {
  const q = (params.get('q') ?? '').trim().slice(0, 200)
  searchBox.value = q
  if (!q) return section(null, element('p', 'empty', t('empty.query')))
  const results = records(await get(`search?${new URLSearchParams({ q, limit: 50 })}`, signal), 'results')
  return section(null, table([t('col.name'), t('col.kind'), t('col.namespace'), t('col.updated')],
    results.map((r) => {
      const kind = r.type === 'JOB' ? 'job' : 'dataset'
      return [lineageLink(kind, r), element('span', `kind ${kind}`, t(`kind.${kind}`)), text(r.namespace), date(r.updatedAt)]
    }), t('empty.search')))
}

// ---------- Lineage asset page ----------
const SVG_STYLE = `text{font:13px system-ui,sans-serif;fill:#1f2937}.edge{fill:none;stroke:#cbd5e1;stroke-width:1.6}
.edge.hot{stroke:#f59e0b}.arrow-head{fill:#94a3b8}rect{fill:#fff;stroke:#d0d7e2;stroke-width:1.4}.job rect{fill:#eef4ff}
.impact rect{fill:#fff7e6;stroke:#f59e0b}.failed rect{fill:#fdecec;stroke:#e5484d}.focus rect{stroke:#2563eb;stroke-width:3}
.dot{fill:#94a3b8}.job .dot{fill:#2563eb}.failed .dot{fill:#e5484d}`

function exportButtons(graph, svgNode, name) {
  const failed = new Set(graph.filter((n) => isFailed(n.data?.latestRun?.state)).map((n) => n.id))
  const copy = element('button', 'btn', t('lineage.copy'))
  copy.type = 'button'
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(toMermaid(graph, failed))
      copy.textContent = `✓ ${t('lineage.copied')}`
    } catch { copy.textContent = t('error.unknown') }
  })
  const download = element('button', 'btn', t('lineage.download'))
  download.type = 'button'
  download.addEventListener('click', () => {
    const clone = svgNode.cloneNode(true)
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    clone.prepend(Object.assign(document.createElementNS('http://www.w3.org/2000/svg', 'style'), { textContent: SVG_STYLE }))
    const url = URL.createObjectURL(new Blob([clone.outerHTML], { type: 'image/svg+xml' }))
    const anchor = Object.assign(document.createElement('a'), { href: url, download: `${name}-lineage.svg` })
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  })
  const fit = element('button', 'btn', t('lineage.fit'))
  fit.type = 'button'
  fit.setAttribute('aria-pressed', 'false')
  fit.addEventListener('click', () => {
    const on = svgNode.parentElement.classList.toggle('fit')
    fit.setAttribute('aria-pressed', String(on))
  })
  return element('div', 'actions', fit, copy, download)
}

function legend() {
  const item = (cls, key) => element('li', '', element('i', `swatch ${cls}`), t(key))
  return element('ul', 'legend', item('job', 'lineage.legend.job'), item('dataset', 'lineage.legend.dataset'),
    item('risk', 'lineage.legend.failed'), item('impactc', 'lineage.legend.impact'), item('focusc', 'lineage.legend.focus'))
}

async function lineagePage({ signal, params }) {
  const { kind, namespace, name } = Object.fromEntries(params)
  if (!['job', 'dataset'].includes(kind) || !namespace || !name) return section(null, element('p', 'empty', t('empty.lineage')))
  const id = nodeId(kind, namespace, name)
  const runsRequest = kind === 'job'
    ? get(`namespaces/${encodeURIComponent(namespace)}/jobs/${encodeURIComponent(name)}/runs?limit=14`, signal)
    : Promise.resolve({ runs: [] })
  const datasetRequest = kind === 'dataset'
    // Checks are optional: a failed dataset fetch must not take the lineage page down.
    ? get(`namespaces/${encodeURIComponent(namespace)}/datasets/${encodeURIComponent(name)}`, signal)
      .catch((error) => { if (error?.name === 'AbortError') throw error; return null })
    : Promise.resolve(null)
  const [graph, runBody, dataset] = await Promise.all([lineageOf(id, signal), runsRequest, datasetRequest])
  const checks = quality(dataset)
  if (!graph.length) return section(null, element('p', 'empty', t('empty.edges')))
  const runs = records(runBody, 'runs')
  const nodes = new Map(graph.map((n) => [n.id, n]))
  const edges = edgesOf(graph)
  const radius = blastRadius(edges, id)
  const upstream = reachable(edges, id, 'up')
  const node = nodes.get(id)
  title.textContent = name

  const score = kind === 'job' ? healthScore(runs) : null
  const stat = (label, value) => element('div', 'stat', element('span', '', label), element('strong', '', value))
  const header = section(null,
    element('div', 'asset-head', element('span', `kind ${kind}`, t(`kind.${kind}`)), element('span', 'muted', namespace),
      kind === 'job' ? status(node?.data?.latestRun?.state) : null),
    node?.data?.description ? element('p', 'description', node.data.description) : null,
    element('div', 'stats', stat(t('lineage.upstream'), String(upstream.size)),
      stat(t('lineage.downstream'), String(radius.jobs.length + radius.datasets.length)),
      stat(t('incidents.outputs'), String(radius.outputs.length)),
      kind === 'job' ? element('div', 'stat', element('span', '', t('col.health')), healthPill(score)) : null,
      checks ? element('div', 'stat', element('span', '', t('col.checks')), checksPill(checks)) : null))

  const svgNode = lineageGraph(graph, {
    focus: id, impact: new Set([...radius.jobs, ...radius.datasets]),
    hrefFor: nodeHref,
  })
  const graphPanel = section(t('lineage.graph'), element('div', 'graph-bar', legend(), exportButtons(graph, svgNode, name)),
    element('div', 'graph-scroll', svgNode))

  const impactPanel = section(t('lineage.outputsAtRisk'), radius.outputs.length
    ? element('ul', 'output-list', ...radius.outputs.map((out) => element('li', '', nodeLink(nodes.get(out) ?? out))))
    : element('p', 'empty', t('lineage.noOutputs')))
  const fields = Array.isArray(node?.data?.fields) ? node.data.fields : []
  const detailPanel = kind === 'job'
    ? section(t('lineage.runs'), runs.length ? durationChart(runs) : null, runs.length ? runStrip(runs) : element('p', 'empty', t('lineage.noRuns')))
    : section(`${t('lineage.schema')} · ${fields.length}`, element('ul', 'fields', ...fields.map((f) => element('li', '', text(f.name)))))

  const details = element('details', 'panel', element('summary', '', `${t('lineage.table')} · ${edges.length}`),
    table([t('col.origin'), '', t('col.destination')], edges.map(({ origin, destination }) =>
      [nodeLink(nodes.get(origin) ?? origin), element('span', 'edge-arrow', '→'), nodeLink(nodes.get(destination) ?? destination)]),
    t('empty.edges')))
  return element('div', 'dashboard', header, graphPanel, element('div', 'grid-2', impactPanel, detailPanel),
    qualityPanel(checks), details)
}

// ---------- About ----------
function aboutPage() {
  const source = Object.assign(element('a', 'record-link', t('about.license')), { href: 'https://github.com/MarquezProject/marquez/tree/0.51.1' })
  const dataset = Object.assign(element('a', 'record-link', 'Kaggle · Brazilian E-Commerce Public Dataset by Olist'),
    { href: 'https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce' })
  return element('div', 'dashboard',
    section(null, element('p', 'lead', t('about.intro'))),
    element('div', 'grid-2',
      section(t('about.features'), element('ul', 'check-list', ...['f1', 'f2', 'f3', 'f4', 'f5', 'f6'].map((k) => element('li', '', t(`about.${k}`))))),
      section(t('about.data'), element('p', '', t('about.dataText')), dataset, source)))
}

// ---------- Router ----------
const pages = {
  overview: { render: overview }, jobs: { render: jobsPage }, datasets: { render: datasetsPage }, events: { render: eventsPage },
  lineage: { render: lineagePage }, search: { render: searchPage }, about: { render: aboutPage, local: true },
}

async function navigate() {
  activeRequest?.abort()
  const { signal } = (activeRequest = new AbortController())
  const [requested, query] = location.hash.slice(1).split('?')
  const page = Object.hasOwn(pages, requested) ? requested : 'overview'
  const params = new URLSearchParams(query)
  const value = Number(params.get('offset'))
  const offset = Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647 ? value : 0
  title.textContent = t(`title.${page}`)
  subtitle.textContent = t(`subtitle.${page}`)
  document.title = `Nexus | ${t(`title.${page}`)}`
  for (const anchor of navLinks) {
    if (anchor.hash === `#${page}`) anchor.setAttribute('aria-current', 'page')
    else anchor.removeAttribute('aria-current')
  }
  content.setAttribute('aria-busy', 'true')
  setConnection('loading')
  content.replaceChildren(element('div', 'skeleton', element('span'), element('span'), element('span')))
  try {
    const view = await pages[page].render({ signal, params, offset })
    if (signal.aborted) return
    content.replaceChildren(view)
    setConnection(pages[page].local ? 'local' : 'connected')
  } catch (error) {
    if (signal.aborted) return
    setConnection('unavailable')
    const retry = Object.assign(element('button', 'btn', t('error.retry')), { type: 'button' })
    retry.addEventListener('click', navigate)
    content.replaceChildren(section(t('error.title'),
      element('p', 'empty', error instanceof Error ? error.message : t('error.unknown')), retry))
  } finally {
    if (!signal.aborted) content.setAttribute('aria-busy', 'false')
  }
}

function setConnection(state) {
  connection.textContent = t(`status.${state}`)
  connection.dataset.state = state
}

function applyLanguage() {
  translateDocument()
  for (const button of document.querySelectorAll('[data-lang]')) button.setAttribute('aria-pressed', String(button.dataset.lang === lang))
}

document.querySelector('.skip-link').addEventListener('click', (event) => { event.preventDefault(); main.focus() })
document.querySelector('.search').addEventListener('submit', (event) => {
  event.preventDefault()
  location.hash = href('search', { q: searchBox.value.trim() })
})
for (const button of document.querySelectorAll('[data-lang]')) {
  button.addEventListener('click', () => { setLang(button.dataset.lang); applyLanguage(); navigate() })
}
window.addEventListener('hashchange', navigate)
applyLanguage()
navigate()
