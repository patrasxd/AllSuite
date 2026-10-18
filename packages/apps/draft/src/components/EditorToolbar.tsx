import { InsertTable } from './TableTools'
import { ExportMenu } from './ExportMenu'
import { printLabels } from './PrintPreview'
import { pageLabels } from './PageSetupDialog'
import type { ExportFormat } from '../engine/export/model'
import { StylePicker } from './StylePicker'
import { clearDirectFormatting, selectionFormat, toggleStyleEmphasis } from '../editor/styles'
import { DraftIcon } from './DraftIcons'
import { useEffect, useState, type ReactNode } from 'react'
import {
  AlignCenterIcon,
  AlignJustifyIcon,
  AlignLeftIcon,
  AlignRightIcon,
  Button,
  CopyIcon,
  CodeIcon,
  CutIcon,
  EraserIcon,
  FilePlusIcon,
  FolderOpenIcon,
  HorizontalRuleIcon,
  IconButton,
  IndentDecreaseIcon,
  IndentIncreaseIcon,
  Input,
  ListIcon,
  ListOrderedIcon,
  PaintbrushIcon,
  PasteIcon,
  PhotoIcon,
  QuoteIcon,
  RedoIcon,
  ReplaceIcon,
  RulerIcon,
  SaveAsIcon,
  SaveIcon,
  SearchIcon,
  Select,
  Text,
  ToolbarPager as ControlsBar,
  ToolbarGroup,
  UndoIcon,
  WorkspaceTabs,
} from '@all/ui'
import { useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import type { Locale } from '../types'
import { translations } from '../i18n'
import { getDraftButtonTooltip, getDraftTabTooltip } from '../button-tooltips'
import {
  DEFAULT_FONT_SIZE,
  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
  normalizeHexColor,
  parseFontSize,
  stepFontSize,
} from '../engine/formatting'
import {
  DOCUMENT_FONTS,
  SYSTEM_FONT_STACK,
  fontPickerValue,
  loadDocumentFont,
  type DocumentFontFamily,
} from '../engine/fonts'
import { documentLanguageChoice, normalizeDocumentLanguage } from '../engine/language'
import { updateSelectedParagraphs } from '../editor/paragraph-commands'
import { applyFormatting, captureFormatting, type FormatSnapshot } from '../editor/format-painter'
import { pageViewLabels } from '../engine/page-view'

interface Props {
  editor: Editor
  locale: Locale
  onClipboard: (action: 'cut' | 'copy' | 'paste' | 'plain' | 'pasteImage') => void
  zoom?: import('../engine/page-view').PageZoom
  onZoom?: (value: import('../engine/page-view').PageZoom) => void
  pageView?: import('../engine/page-view').PageView
  onPageView?: (value: import('../engine/page-view').PageView) => void
  pageSize?: string
  onPageSize?: (value: string) => void
  orientation?: string
  onOrientation?: (value: string) => void
  onPageSetup?: () => void
  onNew?: () => void
  onOpen?: () => void
  onSave?: () => void
  onSaveAs?: () => void
  onExport?: (format: ExportFormat) => void
  onPrint?: () => void
  onPrintPreview?: () => void
  saving?: boolean
  onParagraphDialog?: () => void
  showRuler?: boolean
  onShowRuler?: (value: boolean) => void
  showFormattingMarks?: boolean
  onShowFormattingMarks?: (value: boolean) => void
  autoformat?: boolean
  onAutoformat?: (value: boolean) => void
  hyphenation?: boolean
  onHyphenation?: (value: boolean) => void
  columns?: number
  onColumns?: (value: number) => void
  onFind?: () => void
  onReplace?: () => void
  onSymbols?: () => void
  onEmoji?: () => void
  onImage?: () => void
  onEquation?: () => void
  onCodeBlock?: () => void
  onLink?: () => void
  onReferences?: () => void
  onNavigation?: () => void
  showNavigation?: boolean
  onFocusMode?: () => void
  documentLanguage?: string
  onDocumentLanguage?: (value: string) => void
  commentsOpen?: boolean
  commentCount?: number
  onToggleComments?: () => void
  onAddComment?: () => void
  includeCommentsInPDF?: boolean
  onToggleCommentsInPDF?: () => void
  trackChanges?: boolean
  suggestionsOpen?: boolean
  suggestionCount?: number
  onToggleTracking?: (enabled: boolean) => void
  onToggleSuggestions?: () => void
}

export function EditorToolbar({
  editor,
  locale,
  onClipboard,
  zoom = 100,
  onZoom,
  pageView = 'print',
  onPageView,
  pageSize = 'a4',
  onPageSize,
  orientation = 'portrait',
  onOrientation,
  onPageSetup,
  onNew,
  onOpen,
  onSave,
  onSaveAs,
  onExport,
  onPrint,
  onPrintPreview,
  saving = false,
  onParagraphDialog,
  showRuler = true,
  onShowRuler,
  showFormattingMarks = false,
  onShowFormattingMarks,
  autoformat = true,
  onAutoformat,
  hyphenation = false,
  onHyphenation,
  columns = 1,
  onColumns,
  onFind,
  onReplace,
  onSymbols,
  onEmoji,
  onImage,
  onEquation,
  onCodeBlock,
  onLink,
  onReferences,
  onNavigation,
  showNavigation = false,
  onFocusMode,
  documentLanguage,
  onDocumentLanguage,
  commentsOpen = false,
  commentCount = 0,
  onToggleComments,
  onAddComment,
  includeCommentsInPDF = false,
  onToggleCommentsInPDF,
  trackChanges = false,
  suggestionsOpen = false,
  suggestionCount = 0,
  onToggleTracking,
  onToggleSuggestions,
}: Props) {
  const t = translations[locale]
  const tabs = ['file', 'edit', 'insert', 'format', 'layout', 'view', 'review'] as const
  type ToolbarTab = (typeof tabs)[number]
  const [activeTab, setActiveTab] = useState<ToolbarTab>('format')
  const [painter, setPainter] = useState<{
    snapshot: FormatSnapshot
    repeat: boolean
    source: string
  }>()
  useEffect(() => {
    if (!painter) return
    const apply = () => {
      const selection = editor.state.selection
      if (selection.empty || `${selection.from}:${selection.to}` === painter.source) return
      if (applyFormatting(editor, painter.snapshot) && !painter.repeat) setPainter(undefined)
    }
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPainter(undefined)
    }
    editor.on('selectionUpdate', apply)
    window.addEventListener('keydown', cancel)
    return () => {
      editor.off('selectionUpdate', apply)
      window.removeEventListener('keydown', cancel)
    }
  }, [editor, painter])
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: Boolean(selectionFormat(current).bold),
      italic: Boolean(selectionFormat(current).italic),
      underline: current.isActive('underline'),
      strike: current.isActive('strike'),
      subscript: current.isActive('subscript'),
      superscript: current.isActive('superscript'),
      highlight: current.isActive('highlight'),
      bullet: current.isActive('bulletList'),
      ordered: current.isActive('orderedList'),
      quote: current.isActive('blockquote'),
      align: selectionFormat(current).textAlign || 'left',
      fontSize: `${selectionFormat(current).fontSize || DEFAULT_FONT_SIZE}pt`,
      fontFamily: selectionFormat(current).fontFamily,
      color: selectionFormat(current).color,
      directColor: current.getAttributes('textStyle').color as string | undefined,
      highlightColor: current.getAttributes('highlight').color as string | undefined,
      undo: current.can().undo(),
      redo: current.can().redo(),
      indent: current.can().sinkListItem('listItem'),
      outdent: current.can().liftListItem('listItem'),
      selection: !current.state.selection.empty,
      lineSpacing: selectionFormat(current).lineSpacing || 1.5,
    }),
  })
  const selectedSize = parseFontSize(state.fontSize || '') ?? DEFAULT_FONT_SIZE
  const [sizeInput, setSizeInput] = useState(String(selectedSize))
  const [sizeError, setSizeError] = useState(false)
  const languageChoice = documentLanguageChoice(documentLanguage, locale)
  const [languageInput, setLanguageInput] = useState(languageChoice === 'other' ? documentLanguage || '' : '')
  useEffect(() => {
    setSizeInput(String(selectedSize))
    setSizeError(false)
  }, [selectedSize])
  useEffect(() => {
    if (documentLanguageChoice(documentLanguage, locale) === 'other') setLanguageInput(documentLanguage || '')
  }, [documentLanguage, locale])
  function applySize(value: string, focus = true) {
    const size = parseFontSize(value)
    setSizeError(size === null)
    if (size !== null) {
      setSizeInput(String(size))
      if (!focus && size === selectedSize) return
      const chain = editor.chain()
      if (focus) chain.focus()
      chain.setFontSize(`${size}pt`).run()
    }
  }
  function tool(label: string, icon: ReactNode, command: () => void, active?: boolean, disabled = false) {
    return (
      <IconButton
        aria-label={label}
        tooltip={getDraftButtonTooltip(locale, label)}
        icon={icon}
        size="sm"
        variant={active ? 'primary' : 'outline'}
        aria-pressed={active}
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={command}
      />
    )
  }
  function startPainter(repeat: boolean) {
    const snapshot = captureFormatting(editor)
    if (!snapshot) return
    const { from, to } = editor.state.selection
    setPainter({ snapshot, repeat, source: `${from}:${to}` })
  }
  function applyFont(value: string) {
    void loadDocumentFont(value)
    editor.chain().focus().setFontFamily(value).run()
  }
  function applyCustomLanguage() {
    const normalized = normalizeDocumentLanguage(languageInput)
    if (normalized) onDocumentLanguage?.(normalized)
  }
  return (
    <div className="draft-tools">
      <WorkspaceTabs
        label={t.toolbar}
        items={tabs.map((tab) => ({
          id: tab,
          label: t[tab],
          tooltip: getDraftTabTooltip(locale, tab),
          tabId: `draft-tab-${tab}`,
          panelId: 'draft-command-panel',
        }))}
        activeId={activeTab}
        onChange={(tab) => setActiveTab(tab as ToolbarTab)}
      />

      <div
        id="draft-command-panel"
        className="draft-command-panel"
        role="tabpanel"
        aria-labelledby={`draft-tab-${activeTab}`}
      >
        {activeTab === 'file' && (
          <ControlsBar locale={locale} className="draft-toolbar" role="toolbar" aria-label={t.file}>
            <ToolbarGroup label={t.documentGroup} caption={t.documentGroup}>
              <Button size="sm" variant="outline" icon={<FilePlusIcon />} disabled={saving} onClick={() => onNew?.()}>
                {t.new}
              </Button>
              <Button
                size="sm"
                variant="outline"
                icon={<FolderOpenIcon />}
                disabled={saving}
                onClick={() => onOpen?.()}
              >
                {t.open}
              </Button>
              <Button size="sm" variant="outline" icon={<SaveIcon />} disabled={saving} onClick={() => onSave?.()}>
                {t.save}
              </Button>
              <Button size="sm" variant="outline" icon={<SaveAsIcon />} disabled={saving} onClick={() => onSaveAs?.()}>
                {t.saveAs}
              </Button>
            </ToolbarGroup>
            <ToolbarGroup label={t.outputGroup} caption={t.outputGroup}>
              <ExportMenu
                locale={locale}
                busy={saving}
                onExport={(format) => onExport?.(format)}
                includeCommentsInPDF={includeCommentsInPDF}
                onToggleCommentsInPDF={onToggleCommentsInPDF}
              />
              <Button size="sm" variant="outline" icon={<DraftIcon name="print" />} disabled={saving} onClick={onPrint}>
                {printLabels[locale].print}
              </Button>
              <Button
                size="sm"
                variant="outline"
                icon={<DraftIcon name="preview" />}
                disabled={saving}
                onClick={onPrintPreview}
              >
                {printLabels[locale].preview}
              </Button>
            </ToolbarGroup>
          </ControlsBar>
        )}

        {activeTab === 'insert' && (
          <ControlsBar locale={locale} className="draft-toolbar" role="toolbar" aria-label={t.insert}>
            <ToolbarGroup label={t.pageElementsGroup} caption={t.pageElementsGroup}>
              <Button
                size="sm"
                variant="outline"
                icon={<HorizontalRuleIcon />}
                onClick={() => editor.chain().focus().setHorizontalRule().run()}
              >
                {t.rule}
              </Button>
              <Button
                size="sm"
                variant="outline"
                icon={<DraftIcon name="pageBreak" />}
                onClick={() => editor.chain().focus().insertContent({ type: 'pageBreak' }).run()}
              >
                {pageLabels[locale].break}
              </Button>
            </ToolbarGroup>
            <ToolbarGroup label={t.textObjectsGroup} caption={t.textObjectsGroup}>
              <Button size="sm" variant="outline" icon={<DraftIcon name="symbols" />} onClick={() => onSymbols?.()}>
                {t.specialCharacters}
              </Button>
              <Button size="sm" variant="outline" icon={<DraftIcon name="emoji" />} onClick={() => onEmoji?.()}>
                {t.emoji}
              </Button>
              <Button size="sm" variant="outline" icon={<DraftIcon name="equation" />} onClick={() => onEquation?.()}>
                {t.equation}
              </Button>
              <Button size="sm" variant="outline" icon={<CodeIcon />} onClick={() => onCodeBlock?.()}>
                {t.codeBlock}
              </Button>
            </ToolbarGroup>
            <ToolbarGroup label={t.mediaGroup} caption={t.mediaGroup}>
              <InsertTable editor={editor} locale={locale} />
              <Button size="sm" variant="outline" icon={<PhotoIcon />} onClick={() => onImage?.()}>
                {t.insertImage}
              </Button>
              <Button size="sm" variant="outline" icon={<PasteIcon />} onClick={() => onClipboard('pasteImage')}>
                {t.pasteImage}
              </Button>
            </ToolbarGroup>
            <ToolbarGroup label={t.linksGroup} caption={t.linksGroup}>
              <Button size="sm" variant="outline" icon={<DraftIcon name="link" />} onClick={() => onLink?.()}>
                Link
              </Button>
              <Button
                size="sm"
                variant="outline"
                icon={<DraftIcon name="references" />}
                onClick={() => onReferences?.()}
              >
                {locale === 'pl' ? 'Odwołania' : 'References'}
              </Button>
            </ToolbarGroup>
          </ControlsBar>
        )}
        {activeTab === 'edit' && (
          <ControlsBar locale={locale} className="draft-toolbar" role="toolbar" aria-label={t.edit}>
            <ToolbarGroup label={t.historyGroup} caption={t.historyGroup}>
              {tool(t.undo, <UndoIcon />, () => editor.chain().focus().undo().run(), undefined, !state.undo)}
              {tool(t.redo, <RedoIcon />, () => editor.chain().focus().redo().run(), undefined, !state.redo)}
            </ToolbarGroup>
            <ToolbarGroup label={t.clipboardGroup} caption={t.clipboardGroup}>
              {tool(t.cut, <CutIcon />, () => onClipboard('cut'), undefined, !state.selection)}
              {tool(t.copy, <CopyIcon />, () => onClipboard('copy'), undefined, !state.selection)}
              {tool(t.paste, <PasteIcon />, () => onClipboard('paste'))}
              {tool(t.pastePlain, <span aria-hidden="true">T</span>, () => onClipboard('plain'))}
            </ToolbarGroup>
            <ToolbarGroup label={t.searchGroup} caption={t.searchGroup}>
              {tool(t.find, <SearchIcon />, () => onFind?.())}
              {tool(t.replace, <ReplaceIcon />, () => onReplace?.())}
            </ToolbarGroup>
          </ControlsBar>
        )}

        {activeTab === 'format' && (
          <ControlsBar
            locale={locale}
            className="draft-toolbar draft-toolbar--formatting"
            role="toolbar"
            aria-label={t.format}
          >
            <ToolbarGroup label={t.typographyGroup} caption={t.typographyGroup}>
              <StylePicker editor={editor} locale={locale} />
              <Select
                aria-label={t.fontFamily}
                title={t.fontFamily}
                density="compact"
                value={fontPickerValue(state.fontFamily)}
                options={[
                  { value: SYSTEM_FONT_STACK, label: t.systemFont },
                  ...DOCUMENT_FONTS.map(({ family }) => ({ value: family, label: family })),
                ]}
                onChange={(event) => applyFont(event.target.value as DocumentFontFamily | typeof SYSTEM_FONT_STACK)}
              />
              {tool(
                t.decreaseSize,
                <span aria-hidden="true">−</span>,
                () => applySize(String(stepFontSize(parseFontSize(sizeInput) ?? selectedSize, -1))),
                undefined,
                selectedSize <= MIN_FONT_SIZE,
              )}
              <Input
                className="draft-font-size"
                aria-label={t.fontSize}
                title={t.fontSize}
                density="compact"
                inputMode="decimal"
                value={sizeInput}
                error={sizeError ? t.invalidSize : undefined}
                onChange={(event) => setSizeInput(event.target.value)}
                onBlur={() => applySize(sizeInput, false)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    applySize(sizeInput)
                  }
                }}
              />
              {tool(
                t.increaseSize,
                <span aria-hidden="true">+</span>,
                () => applySize(String(stepFontSize(parseFontSize(sizeInput) ?? selectedSize, 1))),
                undefined,
                selectedSize >= MAX_FONT_SIZE,
              )}
              <Text as="span" variant="caption" className="draft-font-unit">
                pt
              </Text>
            </ToolbarGroup>
            <ToolbarGroup label={t.emphasisGroup} caption={t.emphasisGroup}>
              {tool(
                t.bold,
                <strong aria-hidden="true">B</strong>,
                () => toggleStyleEmphasis(editor, 'bold'),
                state.bold,
              )}
              {tool(t.italic, <em aria-hidden="true">I</em>, () => toggleStyleEmphasis(editor, 'italic'), state.italic)}
              {tool(
                t.underline,
                <u aria-hidden="true">U</u>,
                () => editor.chain().focus().toggleUnderline().run(),
                state.underline,
              )}
              {tool(
                t.strike,
                <s aria-hidden="true">S</s>,
                () => editor.chain().focus().toggleStrike().run(),
                state.strike,
              )}
              {tool(
                t.subscript,
                <span aria-hidden="true">x₂</span>,
                () => editor.chain().focus().unsetSuperscript().toggleSubscript().run(),
                state.subscript,
              )}
              {tool(
                t.superscript,
                <span aria-hidden="true">x²</span>,
                () => editor.chain().focus().unsetSubscript().toggleSuperscript().run(),
                state.superscript,
              )}
            </ToolbarGroup>
            <ToolbarGroup label={t.colorsGroup} caption={t.colorsGroup}>
              <Input
                type="color"
                aria-label={t.color}
                title={t.color}
                density="compact"
                value={normalizeHexColor(state.color || '') || '#000000'}
                onChange={(event) => editor.chain().focus().setColor(event.target.value).run()}
              />
              {tool(
                t.resetColor,
                <span aria-hidden="true">A↺</span>,
                () => editor.chain().focus().unsetColor().run(),
                undefined,
                !state.directColor,
              )}
              {tool(
                t.highlight,
                <span aria-hidden="true">▰</span>,
                () =>
                  editor
                    .chain()
                    .focus()
                    .toggleHighlight({ color: normalizeHexColor(state.highlightColor || '') || '#ffff00' })
                    .run(),
                state.highlight,
              )}
              <Input
                type="color"
                aria-label={t.highlightColor}
                title={t.highlightColor}
                density="compact"
                value={normalizeHexColor(state.highlightColor || '') || '#ffff00'}
                onChange={(event) => editor.chain().focus().setHighlight({ color: event.target.value }).run()}
              />
            </ToolbarGroup>
            <ToolbarGroup label={t.paragraphGroup} caption={t.paragraphGroup}>
              {tool(t.blockquote, <QuoteIcon />, () => editor.chain().focus().toggleBlockquote().run(), state.quote)}
              {tool(t.bulletList, <ListIcon />, () => editor.chain().focus().toggleBulletList().run(), state.bullet)}
              {tool(
                t.orderedList,
                <ListOrderedIcon />,
                () => editor.chain().focus().toggleOrderedList().run(),
                state.ordered,
              )}
              {tool(
                t.indent,
                <IndentIncreaseIcon />,
                () => editor.chain().focus().sinkListItem('listItem').run(),
                undefined,
                !state.indent,
              )}
              {tool(
                t.outdent,
                <IndentDecreaseIcon />,
                () => editor.chain().focus().liftListItem('listItem').run(),
                undefined,
                !state.outdent,
              )}
            </ToolbarGroup>
            <ToolbarGroup label={t.alignment} caption={t.alignment}>
              {tool(
                t.left,
                <AlignLeftIcon />,
                () => editor.chain().focus().setTextAlign('left').run(),
                state.align === 'left',
              )}
              {tool(
                t.center,
                <AlignCenterIcon />,
                () => editor.chain().focus().setTextAlign('center').run(),
                state.align === 'center',
              )}
              {tool(
                t.right,
                <AlignRightIcon />,
                () => editor.chain().focus().setTextAlign('right').run(),
                state.align === 'right',
              )}
              {tool(
                t.justify,
                <AlignJustifyIcon />,
                () => editor.chain().focus().setTextAlign('justify').run(),
                state.align === 'justify',
              )}
            </ToolbarGroup>
            <ToolbarGroup label={t.format} caption={t.format}>
              {tool(t.clearFormatting, <EraserIcon />, () => clearDirectFormatting(editor))}
              {tool(t.formatPainter, <PaintbrushIcon />, () => startPainter(false), Boolean(painter), !state.selection)}
              {tool(
                t.formatPainterRepeat,
                <PaintbrushIcon />,
                () => startPainter(true),
                Boolean(painter?.repeat),
                !state.selection,
              )}
              {tool(t.paragraphSettings, <span aria-hidden="true">¶</span>, () => onParagraphDialog?.())}
              <Select
                aria-label={t.lineSpacing}
                title={t.lineSpacing}
                density="compact"
                value={String(state.lineSpacing)}
                options={[...new Set([1, 1.15, 1.5, 2, state.lineSpacing])].map((value) => ({
                  value: String(value),
                  label: `${value}×`,
                }))}
                onChange={(event) => updateSelectedParagraphs(editor, { lineSpacing: Number(event.target.value) })}
              />
            </ToolbarGroup>
          </ControlsBar>
        )}

        {activeTab === 'layout' && (
          <ControlsBar locale={locale} className="draft-toolbar" role="toolbar" aria-label={t.layout}>
            <ToolbarGroup label={t.layout} caption={t.layout}>
              <Select
                aria-label={t.pageSize}
                title={t.pageSize}
                density="compact"
                value={pageSize}
                options={[
                  { value: 'a4', label: 'A4' },
                  { value: 'letter', label: 'Letter' },
                  { value: 'a5', label: 'A5' },
                  { value: 'legal', label: 'Legal' },
                  { value: 'custom', label: t.custom },
                ]}
                onChange={(event) => onPageSize?.(event.target.value)}
              />
              <Select
                aria-label={t.orientation}
                title={t.orientation}
                density="compact"
                value={orientation}
                options={[
                  { value: 'portrait', label: t.portrait },
                  { value: 'landscape', label: t.landscape },
                ]}
                onChange={(event) => onOrientation?.(event.target.value)}
              />
              <Select
                aria-label={t.columns}
                title={t.columns}
                density="compact"
                value={String(columns)}
                options={[
                  { value: '1', label: t.oneColumn },
                  { value: '2', label: t.twoColumns },
                  { value: '3', label: t.threeColumns },
                ]}
                onChange={(event) => onColumns?.(Number(event.target.value))}
              />
              <Button size="sm" variant="outline" onClick={onPageSetup}>
                {pageLabels[locale].title}
              </Button>
            </ToolbarGroup>
            <ToolbarGroup label={t.paragraphGroup} caption={t.paragraphGroup}>
              <Button
                size="sm"
                variant="outline"
                icon={<DraftIcon name="paragraph" />}
                onClick={() => onParagraphDialog?.()}
              >
                {t.paragraphSettings}
              </Button>
            </ToolbarGroup>
          </ControlsBar>
        )}

        {activeTab === 'view' && (
          <ControlsBar locale={locale} className="draft-toolbar draft-toolbar--view" role="toolbar" aria-label={t.view}>
            <ToolbarGroup label={t.documentLanguage} caption={t.documentLanguage}>
              <Select
                aria-label={t.documentLanguage}
                title={t.documentLanguage}
                density="compact"
                value={languageChoice}
                options={[
                  { value: 'en', label: t.languageEnglish },
                  { value: 'pl', label: t.languagePolish },
                  { value: 'other', label: t.languageOther },
                ]}
                onChange={(event) => {
                  if (event.target.value === 'en') onDocumentLanguage?.('en-US')
                  else if (event.target.value === 'pl') onDocumentLanguage?.('pl-PL')
                  else if (languageChoice !== 'other') {
                    setLanguageInput('de-DE')
                    onDocumentLanguage?.('de-DE')
                  }
                }}
              />
              {languageChoice === 'other' && (
                <Input
                  aria-label={t.languageCode}
                  title={t.languageCode}
                  density="compact"
                  value={languageInput}
                  onChange={(event) => setLanguageInput(event.target.value)}
                  onBlur={applyCustomLanguage}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') applyCustomLanguage()
                  }}
                />
              )}
            </ToolbarGroup>
            <ToolbarGroup label={t.zoom} caption={t.zoom}>
              <Select
                aria-label={t.zoom}
                title={t.zoom}
                density="compact"
                value={String(zoom)}
                options={[
                  ...Array.from(new Set([50, 75, 100, 125, 150, 175, 200, ...(typeof zoom === 'number' ? [zoom] : [])]))
                    .sort((a, b) => a - b)
                    .map((value) => ({ value: String(value), label: `${value}%` })),
                  { value: 'fit', label: pageViewLabels[locale].fit },
                ]}
                onChange={(event) => onZoom?.(event.target.value === 'fit' ? 'fit' : Number(event.target.value))}
              />
              <Select
                aria-label={pageViewLabels[locale].view}
                density="compact"
                value={pageView}
                options={[
                  { value: 'print', label: pageViewLabels[locale].print },
                  { value: 'web', label: pageViewLabels[locale].web },
                ]}
                onChange={(event) => onPageView?.(event.target.value as 'print' | 'web')}
              />
            </ToolbarGroup>
            <ToolbarGroup label={t.displayGroup} caption={t.displayGroup}>
              <Button
                size="sm"
                variant={showNavigation ? 'primary' : 'outline'}
                icon={<DraftIcon name="navigation" />}
                aria-pressed={showNavigation}
                onClick={() => onNavigation?.()}
              >
                {locale === 'pl' ? 'Konspekt' : 'Outline'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => onFocusMode?.()}>
                {locale === 'pl' ? 'Tryb skupienia' : 'Focus mode'}
              </Button>
              <Button
                size="sm"
                variant={showRuler ? 'primary' : 'outline'}
                icon={<RulerIcon />}
                aria-pressed={showRuler}
                onClick={() => onShowRuler?.(!showRuler)}
              >
                {t.ruler}
              </Button>
              <Button
                size="sm"
                variant={showFormattingMarks ? 'primary' : 'outline'}
                icon={<DraftIcon name="paragraph" />}
                aria-pressed={showFormattingMarks}
                onClick={() => onShowFormattingMarks?.(!showFormattingMarks)}
              >
                {t.formattingMarks}
              </Button>
            </ToolbarGroup>
            <ToolbarGroup label={t.automationGroup} caption={t.automationGroup}>
              <Button
                size="sm"
                variant={autoformat ? 'primary' : 'outline'}
                icon={<DraftIcon name="autoformat" />}
                aria-pressed={autoformat}
                onClick={() => onAutoformat?.(!autoformat)}
              >
                {t.autoformat}
              </Button>
              <Button
                size="sm"
                variant={hyphenation ? 'primary' : 'outline'}
                icon={<DraftIcon name="hyphenation" />}
                aria-pressed={hyphenation}
                onClick={() => onHyphenation?.(!hyphenation)}
              >
                {t.hyphenation}
              </Button>
            </ToolbarGroup>
          </ControlsBar>
        )}

        {activeTab === 'review' && (
          <ControlsBar locale={locale} className="draft-toolbar" role="toolbar" aria-label={t.review}>
            <ToolbarGroup label={t.comments} caption={t.comments}>
              <Button
                size="sm"
                variant="outline"
                icon={<DraftIcon name="comments" />}
                disabled={!state.selection}
                title={`${t.addComment} (Ctrl+Alt+M)`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={onAddComment}
              >
                {t.addComment}
              </Button>
              <Button
                size="sm"
                variant={commentsOpen ? 'primary' : 'outline'}
                icon={<DraftIcon name="comments" />}
                aria-pressed={commentsOpen}
                title={`${t.comments} (Ctrl+Alt+Shift+M)`}
                onClick={onToggleComments}
              >
                {t.comments}
                {commentCount ? ` (${commentCount})` : ''}
              </Button>
              <Button
                size="sm"
                variant={includeCommentsInPDF ? 'primary' : 'outline'}
                icon={<DraftIcon name="comments" />}
                aria-pressed={includeCommentsInPDF}
                onClick={onToggleCommentsInPDF}
              >
                {t.includeCommentsInPDF}
              </Button>
            </ToolbarGroup>
            <ToolbarGroup label={t.reviewChanges} caption={t.review}>
              <Button
                size="sm"
                variant={trackChanges ? 'primary' : 'outline'}
                icon={<DraftIcon name="trackChanges" />}
                aria-pressed={trackChanges}
                onClick={() => onToggleTracking?.(!trackChanges)}
              >
                {t.trackChanges}
              </Button>
              <Button
                size="sm"
                variant={suggestionsOpen ? 'primary' : 'outline'}
                icon={<ListIcon />}
                aria-pressed={suggestionsOpen}
                onClick={onToggleSuggestions}
              >
                {t.reviewChanges}
                {suggestionCount ? ` (${suggestionCount})` : ''}
              </Button>
            </ToolbarGroup>
          </ControlsBar>
        )}
      </div>
    </div>
  )
}
