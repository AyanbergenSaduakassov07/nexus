const PAGE_SIZE = 20
const NAMESPACE_PAGE_SIZE = 100
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' })
const countFormat = new Intl.NumberFormat()
const main = document.querySelector('main')
const content = document.querySelector('#content')
const title = document.querySelector('#page-title')
const connection = document.querySelector('#connection')
const navLinks = document.querySelectorAll('.sidebar a[href^="#"]')

let activeRequest

function element(tag, className, ...children) {
  const node = document.createElement(tag)
  if (className) node.className = className
  node.append(...children)
  return node
}

function href(page, params = {}) {
  const query = new URLSearchParams(params).toString()
  return query ? `#${page}?${query}` : `#${page}`
}

function link(text, page, params) {
  const anchor = element('a', 'record-link', text)
  anchor.href = href(page, params)
  return anchor
}

function text(value, fallback = '—') {
  return typeof value === 'string' && value ? value : fallback
}

function date(value) {
  const timestamp = new Date(text(value, ''))
  return Number.isNaN(timestamp.getTime()) ? '—' : dateFormat.format(timestamp)
}

function status(value) {
  const label = text(value, 'Unknown')
  const tone = { COMPLETED: 'ok', COMPLETE: 'ok', FAILED: 'bad', FAIL: 'bad', ABORT: 'bad',
    ABORTED: 'bad', RUNNING: 'active', START: 'active' }[label]
  return element('span', `status ${typeof tone === 'string' ? tone : 'neutral'}`, label.toLowerCase())
}

async function get(path, signal) {
  const response = await fetch(`/api/v1/${path}`, { signal })
  if (response.status === 404) throw new Error('This metadata record was not found.')
  if (!response.ok) throw new Error('The metadata service could not complete this request.')
  const body = await response.json()
  if (!body || typeof body !== 'object') throw new Error('Unexpected metadata response.')
  return body
}

function records(body, key) {
  if (!Array.isArray(body[key])) throw new Error('Unexpected metadata response.')
  return body[key].filter((record) => record && typeof record === 'object')
}

async function listNamespaces(signal) {
  const namespaces = []
  for (let offset = 0; ; offset += NAMESPACE_PAGE_SIZE) {
    const page = await get(`namespaces?limit=${NAMESPACE_PAGE_SIZE}&offset=${offset}`, signal)
    namespaces.push(...records(page, 'namespaces'))
    if (page.namespaces.length < NAMESPACE_PAGE_SIZE) return namespaces
  }
}

function total(body, rows) {
  return Number.isSafeInteger(body.totalCount) && body.totalCount >= rows.length ? body.totalCount : rows.length
}

function section(heading, ...children) {
  return element('section', 'panel', element('h2', '', heading), ...children)
}

function table(headers, rows, empty) {
  if (!rows.length) return element('p', 'empty', empty)
  const headings = headers.map((heading) => {
    const cell = element('th', '', heading)
    cell.scope = 'col'
    return cell
  })
  const body = rows.map((row) => element('tr', '', ...row.map((cell) => element('td', '', cell))))
  const data = element('table', '', element('thead', '', element('tr', '', ...headings)),
    element('tbody', '', ...body))
  return element('div', 'table-scroll', data)
}

function lineageLink(kind, record) {
  const name = text(record?.name, '')
  const namespace = text(record?.namespace, '')
  return name && namespace ? link(name, 'lineage', { kind, namespace, name }) : text(name)
}

function eventTable(events) {
  return table(['Job', 'Namespace', 'Event', 'Time (local)'], events.map((event) => [
    lineageLink('job', event.job), text(event.job?.namespace), status(event.eventType), date(event.eventTime),
  ]), 'No lineage events have arrived.')
}

function pagination(page, offset, count, length, params = {}) {
  const controls = element('nav', 'pagination')
  controls.setAttribute('aria-label', 'Pagination')
  if (offset > 0) controls.append(link('Previous', page, { ...params, offset: Math.max(0, offset - PAGE_SIZE) }))
  const summary = length ? `${offset + 1}–${offset + length} of ${countFormat.format(count)}` : '0 results'
  controls.append(element('span', '', summary))
  if (offset + PAGE_SIZE < count) controls.append(link('Next', page, { ...params, offset: offset + PAGE_SIZE }))
  return controls
}

async function overview({ signal }) {
  const [jobPage, namespaces, eventPage] = await Promise.all([
    get('jobs?limit=1', signal), listNamespaces(signal), get('events/lineage?limit=8', signal),
  ])
  const jobs = records(jobPage, 'jobs')
  const events = records(eventPage, 'events')
  const metrics = [
    ['Jobs', total(jobPage, jobs), 'jobs'],
    ['Namespaces', namespaces.length, 'datasets'],
    ['Lineage events', total(eventPage, events), 'events'],
  ].map(([label, count, page]) => {
    const card = link(label, page)
    card.className = 'metric'
    card.append(element('strong', '', countFormat.format(count)))
    return card
  })
  const namespaceList = namespaces.toReversed().slice(0, 8).map(({ name }) =>
    element('li', '', link(text(name), 'datasets', { namespace: text(name, '') })))
  return element('div', 'dashboard',
    element('div', 'metric-grid', ...metrics),
    element('div', 'overview-grid',
      section('Recent activity', eventTable(events)),
      section('Namespaces', namespaceList.length ? element('ul', 'namespace-list', ...namespaceList) :
        element('p', 'empty', 'No namespaces are available.'))))
}

async function jobs({ signal, offset }) {
  const body = await get(`jobs?limit=${PAGE_SIZE}&offset=${offset}`, signal)
  const rows = records(body, 'jobs')
  return section('Job inventory', table(['Job', 'Namespace', 'Last run', 'Updated'], rows.map((job) => [
    lineageLink('job', job), text(job.namespace), status(job.latestRun?.state), date(job.updatedAt),
  ]), 'No jobs were found.'), pagination('jobs', offset, total(body, rows), rows.length))
}

async function datasets({ signal, offset, params }) {
  const namespaces = await listNamespaces(signal)
  const names = namespaces.map(({ name }) => text(name, '')).filter(Boolean)
  const scope = params.get('namespace')
  const namespace = names.includes(scope) ? scope : names.toReversed()[0]
  if (!namespace) return section('Dataset inventory', element('p', 'empty', 'No namespaces are available.'))

  const body = await get(`namespaces/${encodeURIComponent(namespace)}/datasets?limit=${PAGE_SIZE}&offset=${offset}`, signal)
  const rows = records(body, 'datasets')
  const select = element('select', '', ...names.toSorted().map((name) => {
    const option = element('option', '', name)
    option.value = name
    return option
  }))
  select.id = 'dataset-namespace'
  select.value = namespace
  select.addEventListener('change', () => { location.hash = href('datasets', { namespace: select.value }) })
  const label = element('label', '', 'Namespace')
  label.htmlFor = select.id
  return section('Dataset inventory', element('div', 'filter', label, select),
    table(['Dataset', 'Type', 'Updated'], rows.map((dataset) => [
      lineageLink('dataset', dataset), text(dataset.type), date(dataset.updatedAt),
    ]), 'No datasets were found in this namespace.'),
    pagination('datasets', offset, total(body, rows), rows.length, { namespace }))
}

async function events({ signal, offset }) {
  const body = await get(`events/lineage?limit=${PAGE_SIZE}&offset=${offset}`, signal)
  const rows = records(body, 'events')
  return section('Event stream', eventTable(rows), pagination('events', offset, total(body, rows), rows.length))
}

async function lineage({ signal, params }) {
  const { kind, namespace, name } = Object.fromEntries(params)
  if (!['job', 'dataset'].includes(kind) || !namespace || !name) {
    return section('Explore lineage', element('p', 'empty', 'Select a job or dataset to view its lineage.'))
  }
  const id = `${kind}:${namespace}:${name}`
  const query = new URLSearchParams({ nodeId: id, depth: '4' })
  const graph = records(await get(`lineage?${query}`, signal), 'graph')
  const labels = new Map(graph.map((node) => [node.id, text(node.data?.name, text(node.id))]))
  const edges = graph.flatMap(({ outEdges }) => Array.isArray(outEdges) ? outEdges : [])
    .filter((edge) => typeof edge?.origin === 'string' && typeof edge.destination === 'string')
  const rows = edges.map(({ origin, destination }) => [
    labels.get(origin) ?? origin,
    element('span', 'edge-arrow', '→'),
    labels.get(destination) ?? destination,
  ])
  const subject = element('p', 'lineage-context', `${kind === 'job' ? 'Job' : 'Dataset'} · ${namespace}`)
  return element('div', 'dashboard', section(name, subject,
    element('p', '', `${graph.length} nodes · ${edges.length} edges · depth 4`)),
    section('Directed lineage', table(['Origin', 'Direction', 'Destination'], rows,
      'No lineage edges were returned for this record.')))
}

function about() {
  const source = element('a', 'record-link', 'Marquez source and license')
  source.href = 'https://github.com/MarquezProject/marquez/tree/0.51.1'
  return section('Upstream foundation',
    element('p', '', 'Nexus uses the Marquez 0.51.1 backend for OpenLineage metadata. Marquez is licensed under Apache 2.0.'),
    source)
}

const pages = {
  overview: { title: 'Operations overview', render: overview },
  jobs: { title: 'Jobs', render: jobs },
  datasets: { title: 'Datasets', render: datasets },
  events: { title: 'Events', render: events },
  lineage: { title: 'Lineage', render: lineage },
  about: { title: 'About Nexus', render: about },
}

async function navigate() {
  activeRequest?.abort()
  const { signal } = (activeRequest = new AbortController())
  const [requested, query] = location.hash.slice(1).split('?')
  const page = Object.hasOwn(pages, requested) ? requested : 'overview'
  const params = new URLSearchParams(query)
  const value = Number(params.get('offset'))
  const offset = Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647 ? value : 0
  title.textContent = pages[page].title
  document.title = `Nexus | ${pages[page].title}`
  for (const anchor of navLinks) {
    if (!anchor.classList.contains('brand') && anchor.hash === `#${page}`) anchor.setAttribute('aria-current', 'page')
    else anchor.removeAttribute('aria-current')
  }
  content.setAttribute('aria-busy', 'true')
  connection.textContent = 'Loading'
  content.replaceChildren(element('p', 'empty', 'Loading metadata…'))
  try {
    const view = await pages[page].render({ signal, params, offset })
    if (signal.aborted) return
    content.replaceChildren(view)
    connection.textContent = page === 'about' ? 'Local workspace' : 'Metadata connected'
  } catch (error) {
    if (signal.aborted) return
    connection.textContent = 'Metadata unavailable'
    const retry = element('button', 'retry', 'Retry')
    retry.addEventListener('click', navigate)
    content.replaceChildren(section('Unable to load this view',
      element('p', 'empty', error instanceof Error ? error.message : 'An unexpected error occurred.'), retry))
  } finally {
    if (!signal.aborted) content.setAttribute('aria-busy', 'false')
  }
}

document.querySelector('.skip-link').addEventListener('click', (event) => {
  event.preventDefault()
  main.focus()
})
window.addEventListener('hashchange', navigate)
navigate()
