import { Extension } from '@tiptap/core'
import { tableExtensions } from './tables'
import { DraftImage, measuredImageDOM } from './image-node'
import type { ImageAttributes } from '../engine/images'
import StarterKit from '@tiptap/starter-kit'
import { TextStyle, Color, FontFamily, FontSize } from '@tiptap/extension-text-style'
import TextAlign from '@tiptap/extension-text-align'
import Highlight from '@tiptap/extension-highlight'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import { referenceExtensions } from './references'
import { HEADING_LEVELS } from '../engine/formatting'
import { renderFontFamily } from '../engine/fonts'
import { FormattingMarks } from './formatting-marks'
import { SearchHighlights } from './search-highlights'
import { DocumentPageSetup, PageBreak } from './page-setup'
import { Pagination } from './pagination'
import { CharacterStyle, DocumentStyles } from './styles'

interface ShortcutOptions {
  requestPlainPaste: () => void
  requestLink: () => void
  requestImageEdit?: () => void
  getLocale?: () => string
  onPages?: (pages: number) => void
  measurement?: boolean
}

export function editorExtensions({
  requestPlainPaste,
  requestLink,
  requestImageEdit,
  getLocale,
  onPages,
  measurement,
}: ShortcutOptions) {
  const MappedFontFamily = FontFamily.extend({
    addGlobalAttributes() {
      return [
        {
          types: this.options.types,
          attributes: {
            fontFamily: {
              default: null,
              parseHTML: (element) => element.style.fontFamily || null,
              renderHTML: ({ fontFamily }) =>
                typeof fontFamily === 'string' ? { style: `font-family: ${renderFontFamily(fontFamily)}` } : {},
            },
          },
        },
      ]
    },
  })
  const ParagraphLayout = Extension.create({
    name: 'paragraphLayout',
    addGlobalAttributes() {
      return [
        {
          types: ['paragraph', 'heading'],
          attributes: {
            ...Object.fromEntries(
              ['keepNext', 'keepLines', 'widowControl'].map((name) => [
                name,
                {
                  default: null,
                  parseHTML: (element: HTMLElement) =>
                    element.hasAttribute(`data-${name.toLowerCase()}`)
                      ? element.getAttribute(`data-${name.toLowerCase()}`) === 'true'
                      : null,
                  renderHTML: (attrs: Record<string, unknown>) =>
                    typeof attrs[name] === 'boolean' ? { [`data-${name.toLowerCase()}`]: String(attrs[name]) } : {},
                },
              ]),
            ),
            pageBreakBefore: {
              default: null,
              parseHTML: (element) =>
                element.style.breakBefore === 'page' || element.style.pageBreakBefore === 'always' ? 1 : null,
              renderHTML: ({ pageBreakBefore }) =>
                pageBreakBefore ? { style: 'break-before:page', 'data-page-break-before': 'true' } : {},
            },
            spacingBefore: {
              default: null,
              renderHTML: ({ spacingBefore }) =>
                spacingBefore === null ? {} : { style: `margin-top: ${spacingBefore}pt` },
            },
            spacingAfter: {
              default: null,
              renderHTML: ({ spacingAfter }) =>
                spacingAfter === null ? {} : { style: `margin-bottom: ${spacingAfter}pt` },
            },
            lineSpacing: {
              default: null,
              renderHTML: ({ lineSpacing }) => (lineSpacing === null ? {} : { style: `line-height: ${lineSpacing}` }),
            },
            indentLeft: {
              default: null,
              renderHTML: ({ indentLeft }) => (indentLeft === null ? {} : { style: `margin-left: ${indentLeft}pt` }),
            },
            indentRight: {
              default: null,
              renderHTML: ({ indentRight }) =>
                indentRight === null ? {} : { style: `margin-right: ${indentRight}pt` },
            },
            indentFirstLine: {
              default: null,
              renderHTML: ({ indentFirstLine }) =>
                indentFirstLine === null ? {} : { style: `text-indent: ${indentFirstLine}pt` },
            },
            indentHanging: {
              default: null,
              renderHTML: ({ indentHanging }) =>
                indentHanging === null ? {} : { style: `text-indent: -${indentHanging}pt` },
            },
            tabStops: { default: [] },
          },
        },
        {
          types: ['doc'],
          attributes: { columns: { default: 1 } },
        },
      ]
    },
  })
  const Shortcuts = Extension.create({
    name: 'draftShortcuts',
    priority: 1000,
    addKeyboardShortcuts() {
      return {
        'Mod-u': () => this.editor.commands.toggleUnderline(),
        'Mod-z': () => this.editor.commands.undo(),
        'Mod-y': () => this.editor.commands.redo(),
        'Mod-Shift-z': () => this.editor.commands.redo(),
        'Mod-k': () => {
          requestLink()
          return true
        },
        // Let the browser deliver its trusted clipboard event, then strip formatting.
        'Mod-Shift-v': () => {
          requestPlainPaste()
          return false
        },
        ...Object.fromEntries(
          HEADING_LEVELS.map((level) => [`Mod-Alt-${level}`, () => this.editor.commands.setHeading({ level })]),
        ),
        'Mod-l': () => this.editor.commands.setTextAlign('left'),
        'Mod-e': () => this.editor.commands.setTextAlign('center'),
        'Mod-r': () => this.editor.commands.setTextAlign('right'),
        'Mod-j': () => this.editor.commands.setTextAlign('justify'),
        Tab: () =>
          this.editor.isActive('table')
            ? this.editor.commands.goToNextCell() || this.editor.chain().addRowAfter().goToNextCell().run()
            : this.editor.commands.sinkListItem('listItem') ||
              this.editor.commands.insertContent({ type: 'text', text: '\t' }),
        'Shift-Tab': () =>
          this.editor.isActive('table')
            ? this.editor.commands.goToPreviousCell()
            : this.editor.commands.liftListItem('listItem'),
      }
    },
  })

  return [
    StarterKit.configure({
      heading: { levels: [...HEADING_LEVELS] },
      link: false,
      code: false,
      codeBlock: false,
      dropcursor: false,
      gapcursor: false,
      trailingNode: false,
    }),
    ...tableExtensions,
    (measurement
      ? DraftImage.extend({
          addNodeView:
            () =>
            ({ node }) => ({ dom: measuredImageDOM(node.attrs as ImageAttributes) }),
        })
      : DraftImage
    ).configure({ onEdit: requestImageEdit || (() => {}), getLocale: getLocale || (() => 'en') }),
    TextStyle,
    Color,
    MappedFontFamily,
    FontSize,
    Highlight.configure({ multicolor: true }),
    Subscript,
    Superscript,
    TextAlign.configure({ types: ['paragraph', 'heading'], defaultAlignment: null }),
    ...referenceExtensions,
    ParagraphLayout,
    DocumentPageSetup,
    Pagination.configure({ onPages: onPages || (() => {}) }),
    PageBreak.configure({ label: () => (getLocale?.() === 'pl' ? 'Podział strony' : 'Page break') }),
    DocumentStyles,
    CharacterStyle,
    FormattingMarks,
    SearchHighlights,
    Shortcuts,
  ]
}
