import assert from 'node:assert/strict'
import test from 'node:test'
import { blastRadius, columnLineage, freshness, dailyOutcomes, fitLabel, healthBand, healthScore, layout, nodeRef, owners, quality, reachable, shortName, toMermaid, uniqueEvents } from '../public/model.js'

const run = (state, startedAt = '2026-11-25T01:00:00Z') => ({ state, startedAt })
// raw → job A → mid → job B → out ; mid → job C → side
const edges = [
  ['dataset:n:raw', 'job:n:A'], ['job:n:A', 'dataset:n:mid'], ['dataset:n:mid', 'job:n:B'],
  ['job:n:B', 'dataset:n:out'], ['dataset:n:mid', 'job:n:C'], ['job:n:C', 'dataset:n:side'],
].map(([origin, destination]) => ({ origin, destination }))

test('health is 100 for all-success history', () => {
  assert.equal(healthScore(Array(10).fill(run('COMPLETED'))), 100)
})

test('health penalises a failed latest run on top of the success rate', () => {
  assert.equal(healthScore([run('FAILED'), ...Array(9).fill(run('COMPLETED'))]), 63)
  assert.equal(healthBand(63), 'watch')
})

test('health ignores running runs and is null without terminal runs', () => {
  assert.equal(healthScore([run('RUNNING'), run('COMPLETED')]), 100)
  assert.equal(healthScore([run('RUNNING')]), null)
  assert.equal(healthBand(null), 'unknown')
})

test('blast radius lists downstream jobs, datasets and terminal outputs', () => {
  assert.deepEqual(blastRadius(edges, 'job:n:A'), {
    jobs: ['job:n:B', 'job:n:C'],
    datasets: ['dataset:n:mid', 'dataset:n:out', 'dataset:n:side'],
    outputs: ['dataset:n:out', 'dataset:n:side'],
  })
})

test('upstream traversal follows edges backwards and survives cycles', () => {
  assert.deepEqual([...reachable(edges, 'dataset:n:out', 'up')].sort(),
    ['dataset:n:mid', 'dataset:n:raw', 'job:n:A', 'job:n:B'])
  const cyclic = [...edges, { origin: 'dataset:n:out', destination: 'job:n:A' }]
  assert.equal(reachable(cyclic, 'job:n:A').size, 5)
})

test('layout puts each node one layer right of its deepest parent', () => {
  const ids = [...new Set(edges.flatMap((edge) => [edge.origin, edge.destination]))]
  const position = layout(ids, edges)
  assert.equal(position.get('dataset:n:raw').x, 0)
  assert.equal(position.get('job:n:A').x, 1)
  assert.equal(position.get('dataset:n:out').x, 4)
  assert.equal(position.get('dataset:n:side').x, 4)
})

test('mermaid export marks failed nodes', () => {
  const graph = [{ id: 'job:n:A', outEdges: [{ origin: 'job:n:A', destination: 'dataset:n:mid' }] },
    { id: 'dataset:n:mid', outEdges: [] }]
  assert.equal(toMermaid(graph, new Set(['job:n:A'])),
    'flowchart LR\n  n0["A"]\n  n1[("mid")]\n  n0 --> n1\n  classDef failed fill:#fdecec,stroke:#e5484d\n  class n0 failed')
})

test('daily outcomes bucket runs by UTC day', () => {
  const jobs = [{ latestRuns: [run('FAILED'), run('COMPLETED', '2026-11-24T03:00:00Z')] }]
  assert.deepEqual(dailyOutcomes(jobs, 2, new Date('2026-11-25T12:00:00Z')), [
    { day: '2026-11-24', ok: 1, failed: 0 }, { day: '2026-11-25', ok: 0, failed: 1 },
  ])
})

test('russian strings cover every english key', async () => {
  globalThis.navigator ??= { language: 'en' }
  const { KEYS } = await import('../public/i18n.js')
  assert.deepEqual(KEYS.en.filter((key) => !KEYS.ru.includes(key)), [])
})

test('node refs keep URI namespaces that contain colons', () => {
  const node = { id: 'dataset:postgres://db:5432:public.orders', data: { namespace: 'postgres://db:5432', name: 'public.orders' } }
  assert.deepEqual(nodeRef(node), { kind: 'dataset', namespace: 'postgres://db:5432', name: 'public.orders' })
  assert.equal(shortName(node), 'public.orders')
  assert.deepEqual(nodeRef('job:analytics:fct_sales'), { kind: 'job', namespace: 'analytics', name: 'fct_sales' })
})

test('re-delivered events collapse to one per run and type', () => {
  const run = (runId, eventType) => ({ run: { runId }, eventType })
  const events = [run('a', 'COMPLETE'), run('a', 'COMPLETE'), run('a', 'START'), run('b', 'COMPLETE'), {}, {}]
  assert.deepEqual(uniqueEvents(events), [run('a', 'COMPLETE'), run('a', 'START'), run('b', 'COMPLETE'), {}, {}])
})

test('quality counts dbt test results from the dataQualityAssertions facet', () => {
  const assertions = [
    { assertion: 'not_null', column: 'id', success: true, severity: 'error' },
    { assertion: 'not_null', column: 'first_order', success: false, severity: 'warn', actual: '38' },
    { assertion: 'unique', column: 'id', success: false },
  ]
  const result = quality({ facets: { dataQualityAssertions: { assertions } } })
  assert.equal(result.passed, 1)
  assert.deepEqual(result.failed.map((a) => a.column), ['first_order', 'id'])
  assert.equal(result.blocking, 1, 'only failures without severity warn block')
  assert.equal(quality({ facets: {} }), null)
  assert.equal(quality(null), null)
  assert.equal(quality({ facets: { dataQualityAssertions: { assertions: [null, 'x'] } } }), null, 'malformed entries are ignored')
})

test('fitLabel drops leading dotted segments before clipping', () => {
  assert.equal(fitLabel('dbt-run-jaffle_shop.jaffle_shop.main.jaffle_shop.customers.build.run', 22), 'customers.build.run')
  assert.equal(fitLabel('mart.delivery_performance', 22), 'delivery_performance')
  assert.equal(fitLabel('extract_payments', 22), 'extract_payments')
  assert.equal(fitLabel('a_very_long_name_without_any_dots', 10), 'a_very_lo…')
})

test('column lineage rows follow schema order and drop incomplete inputs', () => {
  const dataset = {
    fields: [{ name: 'month' }, { name: 'gmv' }],
    facets: { columnLineage: { fields: {
      gmv: { inputFields: [{ namespace: 'a', name: 'fct', field: 'price' }, { name: 'no-namespace' }], transformationDescription: 'sum' },
      month: { inputFields: [{ namespace: 'a', name: 'fct', field: 'order_month' }] },
    } } },
  }
  const rows = columnLineage(dataset)
  assert.deepEqual(rows.map((row) => row.column), ['month', 'gmv'])
  assert.equal(rows[1].inputs.length, 1)
  assert.equal(rows[1].transform, 'sum')
  assert.equal(rows[0].transform, '')
  assert.deepEqual(columnLineage({ facets: {} }), [])
})

test('owners come from the ownership facet and skip malformed entries', () => {
  assert.deepEqual(owners({ facets: { ownership: { owners: [{ name: 'team:finance' }, null, { type: 'TEAM' }] } } }), ['team:finance'])
  assert.deepEqual(owners(null), [])
})

test('freshness compares the last successful version with the sla facet', () => {
  const now = Date.parse('2026-11-25T12:00:00Z')
  const dataset = { facets: { sla: { maxAgeHours: 24 } } }
  const versions = [
    { createdAt: '2026-11-25T10:00:00Z', createdByRun: { state: 'FAILED' } },
    { createdAt: '2026-11-24T02:00:00Z', createdByRun: { state: 'COMPLETED' } },
  ]
  assert.deepEqual(freshness(dataset, versions, now), { limit: 24, ageHours: 34, stale: true })
  assert.equal(freshness(dataset, versions.slice(1), Date.parse('2026-11-24T20:00:00Z')).stale, false)
  assert.deepEqual(freshness(dataset, [], now), { limit: 24, ageHours: null, stale: true })
  assert.equal(freshness({ facets: { sla: { maxAgeHours: 'x' } } }, versions, now), null)
})
