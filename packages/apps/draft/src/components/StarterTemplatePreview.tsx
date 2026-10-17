import type { DraftNode } from '../engine/document-model'
import type { StarterTemplate } from '../engine/starter-templates'

type PreviewSection = { heading?: string; lines: Array<{ text: string; list?: boolean }> }

function nodeText(node: DraftNode): string {
  if (node.text) return node.text
  return (node.content || []).map(nodeText).filter(Boolean).join(' ')
}

function styleValue(template: StarterTemplate, styleId: string, key: 'color' | 'fontFamily', fallback: string) {
  const source = template.document.attrs?.styleDefinitions
  if (typeof source !== 'string') return fallback
  try {
    const definitions = JSON.parse(source) as Array<{
      id?: string
      format?: { color?: unknown; fontFamily?: unknown }
    }>
    const value = definitions.find((style) => style.id === styleId)?.format?.[key]
    return typeof value === 'string' ? value : fallback
  } catch {
    return fallback
  }
}

function collectSections(nodes: DraftNode[], title?: DraftNode, subtitle?: DraftNode) {
  const prelude: PreviewSection['lines'] = []
  const sections: PreviewSection[] = []
  let current: PreviewSection | undefined

  for (const node of nodes) {
    if (node === title || node === subtitle) continue
    if (node.type === 'heading') {
      current = { heading: nodeText(node), lines: [] }
      sections.push(current)
    } else if (node.type === 'bulletList' || node.type === 'orderedList') {
      const lines = (node.content || []).slice(0, 2).map((item) => ({ text: nodeText(item), list: true }))
      const target = current ? current.lines : prelude
      target.push(...lines)
    } else {
      const text = nodeText(node)
      if (text) (current?.lines || prelude).push({ text })
    }
  }

  return { prelude, sections }
}

function lineWidth(text: string, max = 63) {
  return Math.max(10, Math.min(max, text.length * 1.45))
}

export function StarterTemplatePreview({ template }: { template: StarterTemplate }) {
  const nodes = template.document.content
  const title = nodes.find((node) => node.attrs?.styleId === 'Title')
  const subtitle = nodes.find((node) => node.attrs?.styleId === 'Subtitle')
  const { prelude, sections } = collectSections(nodes, title, subtitle)
  const titleText = title ? nodeText(title) : template.label
  const subtitleText = subtitle ? nodeText(subtitle) : ''
  const titleColor = styleValue(template, 'Title', 'color', '#30343b')
  const headingColor = styleValue(template, 'Heading1', 'color', '#3f5b73')
  const fontFamily = styleValue(template, 'Title', 'fontFamily', 'Arial, sans-serif')
  const centered = template.id === 'essay'
  const modern = template.id === 'cv-modern'
  const left = template.id === 'cv' ? 10 : 8
  let y = modern ? 27 : 26
  const blocks = [...sections].slice(0, 5)
  const shownPrelude = prelude.slice(0, 2)
  const preludeStartY = y
  y += shownPrelude.length * 4 + (shownPrelude.length > 0 ? 1 : 0)
  const sectionElements = blocks.map((section, sectionIndex) => {
    if (y > 102) return null
    const headingY = y
    y += section.heading ? 4.5 : 0
    const lines = section.lines.slice(0, 2)
    const lineElements = lines.map((line, lineIndex) => {
      const lineY = y + lineIndex * 3.5
      const listOffset = line.list ? 4 : 0
      return (
        <g key={`section-${sectionIndex}-line-${lineIndex}`}>
          {line.list && (
            template.id === 'project-plan' || template.id === 'meeting-notes' ? (
              <text x={left} y={lineY + 1.7} fontFamily={fontFamily} fontSize="3" fill={headingColor}>
                {sectionIndex + lineIndex + 1}.
              </text>
            ) : (
              <circle cx={left + 1} cy={lineY + 1} r=".7" fill={headingColor} />
            )
          )}
          <rect
            x={left + listOffset}
            y={lineY}
            width={lineWidth(line.text, 63 - listOffset)}
            height="1.35"
            rx=".6"
            fill="#a8a8a8"
          />
        </g>
      )
    })
    y += Math.max(lines.length, 1) * 3.5 + 2.5
    return (
      <g key={`section-${sectionIndex}`}>
        {section.heading && (
          <>
            <text
              x={left}
              y={headingY + 3.3}
              fontFamily={fontFamily}
              fontSize="4.1"
              fontWeight="700"
              fill={headingColor}
              textLength={Math.min(58, Math.max(10, section.heading.length * 2.15))}
              lengthAdjust="spacingAndGlyphs"
            >
              {section.heading}
            </text>
            {template.id === 'report' && <rect x={left} y={headingY + 4} width="61" height=".45" fill={headingColor} opacity=".45" />}
          </>
        )}
        {lineElements}
      </g>
    )
  })

  return (
    <span className={`draft-template-preview draft-template-preview--${template.id}`} aria-hidden="true">
      <svg className="draft-template-preview__svg" viewBox="0 0 80 112" role="presentation">
        <rect x="0.5" y="0.5" width="79" height="111" rx="1" fill="#fff" stroke="#d8d8d8" />
        {template.id === 'cv' && <rect x="0.5" y="0.5" width="3" height="111" fill={headingColor} />}
        {modern && <rect x="0.5" y="0.5" width="79" height="23" fill={headingColor} />}
        {modern && <rect x="0.5" y="23.5" width="2" height="88" fill={headingColor} opacity=".25" />}
        <text
          x={centered ? 40 : left}
          y={modern ? 12 : 14}
          textAnchor={centered ? 'middle' : 'start'}
          fontFamily={fontFamily}
          fontSize={template.id.startsWith('cv') ? 6.4 : 6.8}
          fontWeight="700"
          fill={modern ? '#fff' : titleColor}
          textLength={Math.min(centered ? 64 : 66, Math.max(12, titleText.length * 3.5))}
          lengthAdjust="spacingAndGlyphs"
        >
          {titleText}
        </text>
        {subtitleText && (
          <text
            x={centered ? 40 : left}
            y={modern ? 19 : 20}
            textAnchor={centered ? 'middle' : 'start'}
            fontFamily={fontFamily}
            fontSize="3.5"
            fill={modern ? '#fff' : headingColor}
            opacity=".85"
            textLength={Math.min(64, Math.max(12, subtitleText.length * 1.65))}
            lengthAdjust="spacingAndGlyphs"
          >
            {subtitleText}
          </text>
        )}
        {template.id === 'report' && <rect x={left} y="23" width="64" height="1.2" fill={headingColor} />}
        {shownPrelude.map((line, index) => {
          const lineY = preludeStartY + index * 4
          return (
            <rect
              key={`prelude-${index}`}
              x={left}
              y={lineY}
              width={lineWidth(line.text, 58)}
              height="1.35"
              rx=".6"
              fill="#9b9b9b"
            />
          )
        })}
        {sectionElements}
      </svg>
    </span>
  )
}
