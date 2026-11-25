import assert from 'node:assert/strict'
import test from 'node:test'
import { blastRadius, dailyOutcomes, healthBand, healthScore, layout, reachable, toMermaid } from '../public/model.js'

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
