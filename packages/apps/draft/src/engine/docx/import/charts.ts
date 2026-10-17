import { DOMParser } from '@xmldom/xmldom'

const ns = 'http://schemas.openxmlformats.org/drawingml/2006/chart'
const all = (node: Element, local: string) => Array.from(node.getElementsByTagNameNS(ns, local))
const one = (node: Element, local: string) => all(node, local)[0]
const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const colors = ['#245c91', '#ad4b24', '#357348', '#784c91', '#977316', '#297b80']
const label = (x: number, y: number, text: string, anchor = 'middle') =>
  `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="#222" font-family="sans-serif" font-size="14">${escape(text.slice(0, 70))}</text>`

export type Chart = {
  title: string
  type: string
  horizontal: boolean
  series: { name: string; categories: string[]; values: (number | null)[] }[]
}

// Cache indices are significant: sparse points are gaps, never shifted values.
function cache(node: Element | undefined, numeric = false): (string | null)[] {
  if (!node) throw new Error('Missing chart cache')
  const source = one(node, numeric ? 'numCache' : 'strCache') || one(node, 'numCache')
  if (!source) throw new Error('Missing chart cache')
  const count = Number(one(source, 'ptCount')?.getAttribute('val'))
  if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error('Invalid chart cache')
  const points: (string | null)[] = Array(count).fill(null)
  for (const point of all(source, 'pt')) {
    const index = Number(point.getAttribute('idx'))
    if (!Number.isInteger(index) || index < 0 || index >= count) throw new Error('Invalid chart point')
    points[index] = one(point, 'v')?.textContent || null
  }
  return points
}

export function parseChart(xml: string): Chart {
  if (xml.length > 2_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Invalid chart XML')
  const doc = new DOMParser({
    onError: () => {
      throw new Error('Invalid chart XML')
    },
  }).parseFromString(xml, 'application/xml')
  const root = doc.documentElement as unknown as Element
  const titleNode = one(root, 'title')
  const richTitle =
    titleNode &&
    Array.from(titleNode.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 't'))
      .map((n) => n.textContent)
      .join('')
  const title = richTitle || (titleNode && one(titleNode, 'v')?.textContent) || 'Chart'
  const plot = one(root, 'plotArea')
  if (!plot) throw new Error('Missing chart plot')
  const types = Array.from(plot.children).filter((n) => n.namespaceURI === ns && /Chart$/.test(n.localName))
  const type = types.length === 1 ? types[0].localName : 'unsupported'
  const element = types[0]
  if (!element) throw new Error('Missing chart type')
  const elements = types.flatMap((node) => all(node, 'ser'))
  if (elements.length > 20) throw new Error('Too many chart series')
  const series = elements.map((ser, index) => {
    const tx = one(ser, 'tx')
    const name = (tx && one(tx, 'v')?.textContent) || `Series ${index + 1}`
    if (!['barChart', 'lineChart', 'pieChart'].includes(type)) return { name, categories: [], values: [] }
    const categories = cache(one(ser, 'cat')).map((v) => v || '')
    const values = cache(one(ser, 'val'), true).map((v) => {
      if (v === null || !v.trim()) return null
      const number = Number(v)
      if (!Number.isFinite(number) || Math.abs(number) > 1e100) throw new Error('Invalid chart value')
      return number
    })
    if (categories.length !== values.length || !values.some((v) => v !== null)) throw new Error('Empty chart cache')
    return { name, categories, values }
  })
  const grouping = one(element, 'grouping')?.getAttribute('val')
  return {
    title,
    type: grouping === 'stacked' || grouping === 'percentStacked' ? 'unsupported' : type,
    horizontal: one(element, 'barDir')?.getAttribute('val') === 'bar',
    series,
  }
}

export function renderChart(chart: Chart): { svg: string; supported: boolean; alt: string } {
  const { title, series, type, horizontal } = chart
  const height = type === 'pieChart' ? 380 : Math.max(380, 345 + Math.ceil(series.length / 4) * 25 + 12)
  // Stacked/3D/combo and other types deliberately use the fallback rather than invent data.
  const supported =
    ['barChart', 'lineChart', 'pieChart'].includes(type) &&
    series.length > 0 &&
    (type !== 'pieChart' ||
      (series.length === 1 &&
        series[0].values.every((v) => v === null || v >= 0) &&
        series[0].values.some((v) => v! > 0)))
  let body = label(320, 30, title)
  if (!supported) body += label(320, 195, 'Chart not supported')
  else if (type === 'pieChart') {
    const { values, categories } = series[0]
    const sum = values.reduce<number>((total, value) => total + (value || 0), 0)
    let angle = -Math.PI / 2
    values.forEach((value, i) => {
      if (!value) return
      const next = angle + (value / sum) * Math.PI * 2
      const color = colors[i % colors.length]
      if (value === sum) body += `<circle cx="245" cy="190" r="120" fill="${color}"/>`
      else
        body += `<path d="M245 190 L${245 + 120 * Math.cos(angle)} ${190 + 120 * Math.sin(angle)} A120 120 0 ${next - angle > Math.PI ? 1 : 0} 1 ${245 + 120 * Math.cos(next)} ${190 + 120 * Math.sin(next)} Z" fill="${color}"/>`
      angle = next
      if (i < 13) body += label(390, 65 + i * 22, `${categories[i]}: ${value}`, 'start')
    })
    if (values.length > 13) body += label(390, 351, '…', 'start')
  } else {
    const values = series.flatMap((s) => s.values).filter((v): v is number => v !== null)
    const min = Math.min(0, ...values),
      max = Math.max(0, ...values)
    const span = max - min || 1
    const scale = (v: number) => (horizontal ? 120 + ((v - min) / span) * 460 : 300 - ((v - min) / span) * 240)
    const count = Math.max(...series.map((s) => s.values.length))
    const step = (horizontal ? 240 : 500) / count
    body += horizontal
      ? `<path d="M${scale(0)} 60 V300 M120 300 H580" fill="none" stroke="#777"/>`
      : `<path d="M70 60 V300 M70 ${scale(0)} H600" fill="none" stroke="#777"/>`
    body += horizontal
      ? label(120, 320, String(min)) + label(580, 320, String(max))
      : label(65, 55, String(max), 'end') + label(65, 315, String(min), 'end')
    series[0].categories.forEach((category, i) => {
      if (i % Math.max(1, Math.ceil(count / 8))) return
      body += horizontal
        ? label(112, 60 + step * (i + 0.5), category, 'end')
        : label(70 + step * (i + 0.5), 320, category)
    })
    series.forEach((s, si) => {
      const color = colors[si % colors.length]
      let previous: [number, number] | undefined
      s.values.forEach((value, i) => {
        if (value === null) {
          previous = undefined
          return
        }
        const center = 70 + step * (i + 0.5)
        if (type === 'lineChart') {
          const y = scale(value)
          if (previous)
            body += `<path d="M${previous[0]} ${previous[1]} L${center} ${y}" fill="none" stroke="${color}" stroke-width="3"/>`
          body += `<circle cx="${center}" cy="${y}" r="4" fill="${color}"/>`
          previous = [center, y]
        } else {
          const thickness = (step * 0.8) / series.length
          const offset = step * i + step * 0.1 + si * thickness
          body += horizontal
            ? `<rect x="${Math.min(scale(0), scale(value))}" y="${60 + offset}" width="${Math.abs(scale(value) - scale(0))}" height="${thickness}" fill="${color}"/>`
            : `<rect x="${70 + offset}" y="${Math.min(scale(0), scale(value))}" width="${thickness}" height="${Math.abs(scale(value) - scale(0))}" fill="${color}"/>`
        }
      })
      const x = 12 + (si % 4) * 155,
        y = 345 + Math.floor(si / 4) * 25
      body +=
        `<rect x="${x}" y="${y}" width="12" height="12" fill="${color}"/>` +
        label(x + 18, y + 12, s.name.slice(0, 17), 'start')
    })
  }
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="${height}" viewBox="0 0 640 ${height}"><rect width="640" height="${height}" fill="white"/>${body}</svg>`,
    supported,
    alt: [title, ...series.map((s) => s.name)].join('; '),
  }
}
