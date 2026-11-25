// SVG builders. Colours come from CSS classes so the stylesheet owns the palette.
import { t } from './i18n.js'
import { edgesOf, isFailed, layout, shortName } from './model.js'

const NS = 'http://www.w3.org/2000/svg'
const NODE_W = 188
const NODE_H = 40
const COL_GAP = 84
const ROW_GAP = 22
const PAD = 16

export function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(NS, tag)
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value))
  node.append(...children)
  return node
}

function clip(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/**
 * Lineage graph. `focus` is highlighted, `impact` (a Set of ids) is tinted as downstream impact,
 * `hrefFor(node)` returns the link target for each node.
 */
export function lineageGraph(graph, { focus, impact, hrefFor }) {
  const ids = graph.map((node) => node.id)
  const edges = edgesOf(graph).filter((edge) => ids.includes(edge.origin) && ids.includes(edge.destination))
  const position = layout(ids, edges)
  const point = (id) => {
    const { x, y } = position.get(id)
    return { x: PAD + x * (NODE_W + COL_GAP), y: PAD + y * (NODE_H + ROW_GAP) }
  }
  const width = PAD * 2 + Math.max(...[...position.values()].map((p) => p.x)) * (NODE_W + COL_GAP) + NODE_W
  const height = PAD * 2 + Math.max(...[...position.values()].map((p) => p.y)) * (NODE_H + ROW_GAP) + NODE_H
  const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, width, height, class: 'graph', role: 'img',
    'aria-label': `${t('lineage.graph')}: ${ids.length} ${t('lineage.nodes')}, ${edges.length} ${t('lineage.edges')}` })
  root.append(svg('defs', {}, svg('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 9, refY: 5,
    markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, svg('path', { d: 'M0 0 L10 5 L0 10 z', class: 'arrow-head' }))))

  for (const { origin, destination } of edges) {
    const a = point(origin)
    const b = point(destination)
    const [x1, y1, x2, y2] = [a.x + NODE_W, a.y + NODE_H / 2, b.x - 2, b.y + NODE_H / 2]
    const bend = Math.max(30, (x2 - x1) / 2)
    const hot = impact.has(destination) && (impact.has(origin) || origin === focus)
    root.append(svg('path', { d: `M${x1} ${y1} C${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2} ${y2}`,
      class: hot ? 'edge hot' : 'edge', 'marker-end': 'url(#arrow)' }))
  }

  for (const node of graph) {
    const { x, y } = point(node.id)
    const job = node.id.startsWith('job:')
    const failed = job && isFailed(node.data?.latestRun?.state)
    const classes = ['node', job ? 'job' : 'dataset', failed && 'failed', impact.has(node.id) && 'impact',
      node.id === focus && 'focus'].filter(Boolean).join(' ')
    const name = shortName(node.id)
    const link = svg('a', { href: hrefFor(node), class: classes },
      svg('title', {}, `${job ? t('kind.job') : t('kind.dataset')}: ${name}`),
      svg('rect', { x, y, width: NODE_W, height: NODE_H, rx: job ? NODE_H / 2 : 8 }),
      svg('circle', { cx: x + 18, cy: y + NODE_H / 2, r: 5, class: 'dot' }),
      svg('text', { x: x + 32, y: y + NODE_H / 2 + 4.5 }, clip(name, 22)))
    root.append(link)
  }
  return root
}

/** Stacked daily bars: green succeeded, red failed. */
export function runsChart(buckets) {
  const width = 640
  const height = 180
  const base = height - 22
  const max = Math.max(1, ...buckets.map((b) => b.ok + b.failed))
  const step = width / buckets.length
  const barW = Math.min(28, step * 0.62)
  const scale = (value) => (value / max) * (base - 10)
  const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart', role: 'img',
    'aria-label': t('chart.runs') })
  root.append(svg('line', { x1: 0, x2: width, y1: base, y2: base, class: 'axis' }))
  buckets.forEach((bucket, index) => {
    const cx = index * step + step / 2
    const okH = scale(bucket.ok)
    const badH = scale(bucket.failed)
    const group = svg('g', {}, svg('title', {}, `${bucket.day}: ${bucket.ok} ${t('chart.ok')}, ${bucket.failed} ${t('chart.failed')}`),
      svg('rect', { x: cx - barW / 2, y: base - okH, width: barW, height: okH, rx: 3, class: 'bar ok' }),
      svg('rect', { x: cx - barW / 2, y: base - okH - badH - (badH ? 2 : 0), width: barW, height: badH, rx: 3, class: 'bar bad' }))
    if (index % 2 === buckets.length % 2 || index === buckets.length - 1) {
      group.append(svg('text', { x: cx, y: height - 4, class: 'tick' }, bucket.day.slice(5)))
    }
    root.append(group)
  })
  return root
}

/** One coloured square per run, newest on the right. */
export function runStrip(runs) {
  const list = (Array.isArray(runs) ? runs : []).slice(0, 10).reverse()
  const root = svg('svg', { viewBox: `0 0 ${list.length * 12} 12`, width: list.length * 12, height: 12,
    class: 'strip', role: 'img', 'aria-label': list.map((run) => run.state).join(', ') || '—' })
  list.forEach((run, index) => {
    const tone = run.state === 'COMPLETED' ? 'ok' : isFailed(run.state) ? 'bad' : 'neutral'
    root.append(svg('rect', { x: index * 12, y: 0, width: 9, height: 12, rx: 2, class: `cell ${tone}` },
      svg('title', {}, `${run.state} · ${String(run.startedAt ?? '').slice(0, 16).replace('T', ' ')}`)))
  })
  return root
}

/** Run durations as vertical bars, coloured by outcome, oldest on the left. */
export function durationChart(runs) {
  const list = runs.filter((run) => Number.isFinite(run.durationMs)).slice(0, 14).reverse()
  const width = 320
  const height = 96
  const max = Math.max(1, ...list.map((run) => run.durationMs))
  const step = width / Math.max(list.length, 1)
  const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart', role: 'img', 'aria-label': t('lineage.runs') })
  list.forEach((run, index) => {
    const h = (run.durationMs / max) * (height - 8)
    root.append(svg('rect', { x: index * step + step * 0.2, y: height - h, width: step * 0.6, height: h, rx: 2,
      class: `bar ${isFailed(run.state) ? 'bad' : 'ok'}` },
    svg('title', {}, `${String(run.startedAt).slice(0, 10)} · ${run.state} · ${Math.round(run.durationMs / 60000)} ${t('unit.min')}`)))
  })
  return root
}
