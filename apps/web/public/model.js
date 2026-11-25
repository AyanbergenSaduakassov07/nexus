// Pure functions: health scoring, impact traversal, graph layout, exports. No DOM access.

export const HEALTH_RUNS = 10
const OK = new Set(['COMPLETED'])
const BAD = new Set(['FAILED', 'ABORTED'])

/** Health 0–100 = 70 × success rate over terminal runs + 30 if the latest terminal run succeeded. */
export function healthScore(runs) {
  const terminal = (Array.isArray(runs) ? runs : [])
    .filter((run) => OK.has(run?.state) || BAD.has(run?.state)).slice(0, HEALTH_RUNS)
  if (!terminal.length) return null
  const ok = terminal.filter((run) => OK.has(run.state)).length
  return Math.round(70 * (ok / terminal.length) + (OK.has(terminal[0].state) ? 30 : 0))
}

export function healthBand(score) {
  if (score === null || score === undefined) return 'unknown'
  return score >= 85 ? 'healthy' : score >= 60 ? 'watch' : 'risk'
}

export function isFailed(state) {
  return BAD.has(state)
}

/** dbt / data-quality test results from a dataset's OpenLineage dataQualityAssertions facet; null if none. */
export function quality(dataset) {
  const assertions = dataset?.facets?.dataQualityAssertions?.assertions
  if (!Array.isArray(assertions)) return null
  const valid = assertions.filter((a) => a && typeof a === 'object')
  if (!valid.length) return null
  const failed = valid.filter((a) => a.success === false)
  return {
    assertions: valid, failed, passed: valid.length - failed.length,
    blocking: failed.filter((a) => a.severity !== 'warn').length,
  }
}

/** Owner names (e.g. "team:finance") from a dataset's OpenLineage ownership facet. */
export function owners(dataset) {
  const list = dataset?.facets?.ownership?.owners
  return Array.isArray(list) ? list.map((owner) => owner?.name).filter((name) => typeof name === 'string' && name) : []
}

/** Freshness against the dataset's `sla` facet (Nexus custom): age of the newest version a completed run wrote. */
export function freshness(dataset, versions, now = Date.now()) {
  const limit = Number(dataset?.facets?.sla?.maxAgeHours)
  if (!(limit > 0)) return null
  const done = (Array.isArray(versions) ? versions : []).find((version) => version?.createdByRun?.state === 'COMPLETED')
  const at = Date.parse(done?.createdAt)
  const ageHours = Number.isFinite(at) ? Math.max(0, (now - at) / 3_600_000) : null
  return { limit, ageHours, stale: ageHours === null || ageHours > limit }
}

/** Rows of the columnLineage facet: each column, the input fields it comes from, and how; in schema order. */
export function columnLineage(dataset) {
  const fields = dataset?.facets?.columnLineage?.fields
  if (!fields || typeof fields !== 'object') return []
  const order = (Array.isArray(dataset.fields) ? dataset.fields : []).map((field) => field?.name)
  const rank = (column) => (order.includes(column) ? order.indexOf(column) : order.length)
  return Object.entries(fields).map(([column, field]) => ({
    column,
    inputs: (Array.isArray(field?.inputFields) ? field.inputFields : [])
      .filter((input) => input?.namespace && input?.name && input?.field),
    transform: typeof field?.transformationDescription === 'string' ? field.transformationDescription : '',
  })).sort((a, b) => rank(a.column) - rank(b.column) || a.column.localeCompare(b.column))
}

export function edgesOf(graph) {
  return graph.flatMap(({ outEdges }) => Array.isArray(outEdges) ? outEdges : [])
    .filter((edge) => typeof edge?.origin === 'string' && typeof edge.destination === 'string')
}

/** Breadth-first walk from `start` along edge direction ('down') or against it ('up'). */
export function reachable(edges, start, direction = 'down') {
  const next = new Map()
  for (const { origin, destination } of edges) {
    const [from, to] = direction === 'down' ? [origin, destination] : [destination, origin]
    if (!next.has(from)) next.set(from, [])
    next.get(from).push(to)
  }
  const seen = new Set([start])
  const queue = [start]
  while (queue.length) {
    for (const id of next.get(queue.shift()) ?? []) {
      if (!seen.has(id)) { seen.add(id); queue.push(id) }
    }
  }
  seen.delete(start)
  return seen
}

/** Downstream blast radius: affected jobs, datasets, and terminal outputs (datasets nobody consumes). */
export function blastRadius(edges, start) {
  const down = [...reachable(edges, start, 'down')].sort()
  const consumed = new Set(edges.map((edge) => edge.origin))
  const datasets = down.filter((id) => id.startsWith('dataset:'))
  return {
    jobs: down.filter((id) => id.startsWith('job:')),
    datasets,
    outputs: datasets.filter((id) => !consumed.has(id)),
  }
}

/** Layered left-to-right layout: layer = longest path from a source; order by parent barycentre. */
export function layout(ids, edges) {
  const layer = new Map(ids.map((id) => [id, 0]))
  // Bellman-style relaxation; cap iterations so a cycle cannot loop forever.
  for (let pass = 0, changed = true; changed && pass < ids.length; pass++) {
    changed = false
    for (const { origin, destination } of edges) {
      if (layer.has(origin) && layer.has(destination) && layer.get(destination) < layer.get(origin) + 1) {
        layer.set(destination, layer.get(origin) + 1)
        changed = true
      }
    }
  }
  const columns = []
  for (const id of [...ids].sort()) (columns[layer.get(id)] ??= []).push(id)
  const row = new Map()
  for (const column of columns.filter(Boolean)) {
    const weight = (id) => {
      const parents = edges.filter((edge) => edge.destination === id && row.has(edge.origin))
      return parents.length ? parents.reduce((sum, edge) => sum + row.get(edge.origin), 0) / parents.length : Infinity
    }
    const weights = new Map(column.map((id) => [id, weight(id)]))
    column.sort((a, b) => weights.get(a) - weights.get(b) || a.localeCompare(b))
    column.forEach((id, index) => row.set(id, index))
  }
  const height = Math.max(1, ...columns.map((column) => column?.length ?? 0))
  return new Map(ids.map((id) => {
    const size = columns[layer.get(id)].length
    return [id, { x: layer.get(id), y: row.get(id) + (height - size) / 2 }]
  }))
}

/** Kind, namespace and name of a lineage node. Namespaces may be URIs with colons, so node data wins over the id. */
export function nodeRef(node) {
  const id = String(node?.id ?? node)
  const [kind, namespace, ...rest] = id.split(':')
  const data = node?.data
  return data?.namespace && data?.name
    ? { kind, namespace: data.namespace, name: data.name }
    : { kind, namespace, name: rest.join(':') }
}

/** Drop re-delivered events (OpenLineage is at-least-once): keep the first per run and event type. */
export function uniqueEvents(events) {
  const seen = new Set()
  return events.filter((event) => {
    const key = `${event.run?.runId}/${event.eventType}`
    if (!event.run?.runId || !seen.has(key)) return seen.add(key)
    return false
  })
}

export const shortName = (node) => nodeRef(node).name || String(node?.id ?? node)

/** Fit a name into `max` chars: drop leading dotted segments (the distinguishing part is last), then clip. */
export function fitLabel(name, max) {
  const parts = name.split('.')
  while (parts.length > 1 && parts.join('.').length > max) parts.shift()
  const label = parts.join('.')
  return label.length > max ? `${label.slice(0, max - 1)}…` : label
}

/** Mermaid flowchart source for the graph, so lineage can be pasted into docs or PRs. */
export function toMermaid(graph, failed = new Set()) {
  const key = new Map(graph.map((node, index) => [node.id, `n${index}`]))
  const safe = (text) => text.replaceAll('"', "'")
  const lines = ['flowchart LR']
  for (const node of graph) {
    const label = safe(shortName(node))
    lines.push(node.id.startsWith('job:') ? `  ${key.get(node.id)}["${label}"]` : `  ${key.get(node.id)}[("${label}")]`)
  }
  for (const { origin, destination } of edgesOf(graph)) {
    if (key.has(origin) && key.has(destination)) lines.push(`  ${key.get(origin)} --> ${key.get(destination)}`)
  }
  const bad = graph.filter((node) => failed.has(node.id)).map((node) => key.get(node.id))
  if (bad.length) lines.push('  classDef failed fill:#fdecec,stroke:#e5484d', `  class ${bad.join(',')} failed`)
  return lines.join('\n')
}

/** Runs per UTC day and outcome over the last `days` days, from each job's recent runs. */
export function dailyOutcomes(jobs, days, now = new Date()) {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const buckets = Array.from({ length: days }, (_, index) => ({
    day: new Date(end - (days - 1 - index) * 86_400_000).toISOString().slice(0, 10), ok: 0, failed: 0,
  }))
  const byDay = new Map(buckets.map((bucket) => [bucket.day, bucket]))
  for (const job of jobs) {
    for (const run of Array.isArray(job?.latestRuns) ? job.latestRuns : []) {
      const bucket = byDay.get(String(run?.startedAt ?? run?.createdAt ?? '').slice(0, 10))
      if (bucket && OK.has(run.state)) bucket.ok++
      else if (bucket && BAD.has(run.state)) bucket.failed++
    }
  }
  return buckets
}
