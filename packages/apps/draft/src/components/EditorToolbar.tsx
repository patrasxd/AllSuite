import { createPortal } from 'react-dom'
import { EditorActionCluster, EditorNavigation, type EditorActions } from '../../../../ui/src/EditorChrome'
import { InsertTable } from './TableTools'
import { exportLabels } from './ExportMenu'
import { RibbonMenuButton } from '../../../../ui/src/RibbonMenuButton'
import { printLabels } from './PrintPreview'
import { pageLabels } from './PageSetupDialog'
import type { ExportFormat } from '../engine/export/model'
import { StylePicker } from './StylePicker'
import { clearDirectFormatting, selectionFormat, toggleStyleEmphasis } from '../editor/styles'
import { DraftIcon } from './DraftIcons'
import { useEffect, useRef, useState, type ReactNode } from 'react'
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
  ReplaceIcon,
  RulerIcon,
  SaveAsIcon,
  SaveIcon,
  SearchIcon,
  Select,
  ControlsBar,
  ToolbarGroup,
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
  headerActions?: HTMLSpanElement | null
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
  onHeaderFooter?: () => void
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
  headerActions,
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
  onHeaderFooter,
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
  const tabs = ['home', 'insert', 'layout', 'review', 'view'] as const
  const homeLabel = locale === 'pl' ? 'Narzędzia główne' : 'Home'
  const [mobile, setMobile] = useState(() =>
    Boolean(window.matchMedia?.('(max-width: 599px), (max-width: 899px) and (max-height: 499px)').matches),
  )
  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 599px), (max-width: 899px) and (max-height: 499px)')
    if (!media) return
    const update = () => {
      setMobile(media.matches)
      if (!media.matches) setMoreOpen(false)
    }
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  type ToolbarTab = (typeof tabs)[number]
  const [activeTab, setActiveTab] = useState<ToolbarTab>('home')
  const [moreOpen, setMoreOpen] = useState(false)
  const moreButton = useRef<HTMLButtonElement>(null)
  const moreOpenRef = useRef(false)
  const moreBack = useRef(false)
  moreOpenRef.current = moreOpen
  useEffect(() => {
    if (window.history.state?.draftRibbonMore) {
      const state = { ...window.history.state }
      delete state.draftRibbonMore
      window.history.replaceState(state, '')
    }
    const back = (event: PopStateEvent) => {
      if (document.querySelector('.allsuite-task-pane-host:not([hidden])')) return
      if (!moreOpenRef.current && !moreBack.current) return
      event.stopImmediatePropagation()
      moreBack.current = false
      setMoreOpen(false)
      moreButton.current?.focus()
    }
    window.addEventListener('popstate', back, true)
    return () => window.removeEventListener('popstate', back, true)
  }, [])
  useEffect(() => {
    if (!moreOpen) return
    window.history.pushState({ ...window.history.state, draftRibbonMore: true }, '')
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('.allsuite-ribbon-menu__items, [role="dialog"]')) {
        setMoreOpen(false)
        moreButton.current?.focus()
      }
    }
    window.addEventListener('keydown', close)
    const frame = requestAnimationFrame(() =>
      document.querySelector<HTMLButtonElement>('.draft-more-heading button')?.focus(),
    )
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('keydown', close)
      if (window.history.state?.draftRibbonMore) {
        moreBack.current = true
        window.history.back()
      }
    }
  }, [moreOpen])
  useEffect(() => {
    const viewport = window.visualViewport
    const workspace = document.querySelector<HTMLElement>('.draft-workspace')
    if (!viewport || !workspace) return
    const fit = () => {
      if (viewport.scale !== 1) return
      workspace.style.setProperty(
        '--draft-visible-height',
        `${Math.max(0, viewport.height + viewport.offsetTop - workspace.getBoundingClientRect().top)}px`,
      )
      if (!window.matchMedia('(max-width: 599px), (max-width: 899px) and (max-height: 499px)').matches)
        setMoreOpen(false)
    }
    fit()
    viewport.addEventListener('resize', fit)
    viewport.addEventListener('scroll', fit)
    return () => {
      viewport.removeEventListener('resize', fit)
      viewport.removeEventListener('scroll', fit)
      workspace.style.removeProperty('--draft-visible-height')
    }
  }, [])
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
  const editorActions: EditorActions = {
    undo: () => {
      editor.chain().focus().undo().run()
    },
    redo: () => {
      editor.chain().focus().redo().run()
    },
    save: () => onSave?.(),
    canUndo: state.undo,
    canRedo: state.redo,
    saving,
    labels: {
      undo: t.undo,
      redo: t.redo,
      save: locale === 'pl' ? 'Zapisz dokument' : 'Save document',
      group: t.documentGroup,
    },
  }
  const fileTrigger = () => (
    <RibbonMenuButton variant="outline" label={t.file}>
      <Button size="sm" variant="ghost" icon={<FilePlusIcon />} disabled={saving} onClick={onNew}>
        {t.new}
      </Button>
      <Button size="sm" variant="ghost" icon={<FolderOpenIcon />} disabled={saving} onClick={onOpen}>
        {t.open}
      </Button>
      <Button size="sm" variant="ghost" icon={<SaveIcon />} disabled={saving} onClick={onSave}>
        {t.save}
      </Button>
      <Button size="sm" variant="ghost" icon={<SaveAsIcon />} disabled={saving} onClick={onSaveAs}>
        {t.saveAs}
      </Button>
      {(['pdf', 'odt', 'markdown', 'html', 'text'] as ExportFormat[]).map((format) => (
        <Button key={format} size="sm" variant="ghost" disabled={saving} onClick={() => onExport?.(format)}>
          {exportLabels[locale][format]}
        </Button>
      ))}
      <Button size="sm" variant="ghost" icon={<DraftIcon name="preview" />} disabled={saving} onClick={onPrintPreview}>
        {printLabels[locale].preview}
      </Button>
      <Button size="sm" variant="ghost" icon={<DraftIcon name="print" />} disabled={saving} onClick={onPrint}>
        {printLabels[locale].print}
      </Button>
    </RibbonMenuButton>
  )
  return (
    <div className={`draft-tools${moreOpen ? ' draft-tools--more' : ''}`}>
      {headerActions &&
        createPortal(
          <>
            {fileTrigger()}
            <EditorActionCluster actions={editorActions} saveOnly />
          </>,
          headerActions,
        )}
      <EditorNavigation
        aria-label={t.toolbar}
        file={fileTrigger()}
        actions={editorActions}
        tabs={{
          label: t.toolbar,
          items: tabs.map((tab) => ({
            id: tab,
            label: tab === 'home' ? homeLabel : t[tab],
            tooltip: tab === 'home' ? homeLabel : getDraftTabTooltip(locale, tab),
            tabId: `draft-tab-${tab}`,
            panelId: 'draft-command-panel',
          })),
          activeId: activeTab,
          onChange: (tab) => setActiveTab(tab as ToolbarTab),
        }}
      />

      {mobile && (
        <div className="draft-mobile-dock" role="toolbar" aria-label={t.toolbar}>
          {activeTab === 'home' ? (
            <>
              {tool(t.bold, <strong>B</strong>, () => toggleStyleEmphasis(editor, 'bold'), state.bold)}
              {tool(t.italic, <em>I</em>, () => toggleStyleEmphasis(editor, 'italic'), state.italic)}
              <RibbonMenuButton label={t.clipboardGroup} variant="outline" icon={<PasteIcon />}>
                <Button size="sm" variant="ghost" onClick={() => onClipboard('paste')}>
                  {t.paste}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onClipboard('copy')} disabled={!state.selection}>
                  {t.copy}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onClipboard('cut')} disabled={!state.selection}>
                  {t.cut}
                </Button>
              </RibbonMenuButton>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (activeTab === 'insert') onImage?.()
                else if (activeTab === 'layout') onPageSetup?.()
                else if (activeTab === 'review') onToggleComments?.()
                else onNavigation?.()
              }}
            >
              {activeTab === 'insert'
                ? t.insertImage
                : activeTab === 'layout'
                  ? pageLabels[locale].title
                  : activeTab === 'review'
                    ? t.comments
                    : locale === 'pl'
                      ? 'Konspekt'
                      : 'Outline'}
            </Button>
          )}
          <Button
            ref={moreButton}
            size="sm"
            variant="outline"
            aria-expanded={moreOpen}
            aria-controls="draft-command-panel"
            onClick={() => setMoreOpen(!moreOpen)}
          >
            {locale === 'pl' ? 'Więcej' : 'More'}
          </Button>
        </div>
      )}
      <div
        id="draft-command-panel"
        className="draft-command-panel allsuite-ribbon-surface"
        role="tabpanel"
        aria-labelledby={`draft-tab-${activeTab}`}
      >
        <div className="draft-more-heading">
          <span>{activeTab === 'home' ? homeLabel : t[activeTab]}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setMoreOpen(false)
              moreButton.current?.focus()
            }}
          >
            {locale === 'pl' ? 'Gotowe' : 'Done'}
          </Button>
        </div>
        {activeTab === 'insert' && (
          <ControlsBar
            className="allsuite-editor-toolbar allsuite-ribbon-toolbar draft-toolbar"
            role="toolbar"
            aria-label={t.insert}
          >
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
            <ToolbarGroup
              label={locale === 'pl' ? 'Nagłówek i stopka' : 'Header & footer'}
              caption={locale === 'pl' ? 'Nagłówek i stopka' : 'Header & footer'}
            >
              <Button size="sm" variant="outline" onClick={onHeaderFooter}>
                {locale === 'pl' ? 'Nagłówek i stopka' : 'Header & footer'}
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
        {activeTab === 'home' && (
          <ControlsBar
            className="allsuite-editor-toolbar allsuite-ribbon-toolbar draft-toolbar"
            role="toolbar"
            aria-label={homeLabel}
          >
            <ToolbarGroup label={t.clipboardGroup} caption={t.clipboardGroup} className="">
              <RibbonMenuButton
                variant="outline"
                label={t.paste}
                icon={<PasteIcon />}
                presentation="large"
                primaryAction={() => onClipboard('paste')}
                optionsLabel={locale === 'pl' ? 'Opcje wklejania' : 'Paste options'}
              >
                <Button size="sm" variant="ghost" icon={<PasteIcon />} onClick={() => onClipboard('paste')}>
                  {t.paste}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onClipboard('plain')}>
                  {t.pastePlain}
                </Button>
                <Button size="sm" variant="ghost" icon={<PhotoIcon />} onClick={() => onClipboard('pasteImage')}>
                  {t.pasteImage}
                </Button>
              </RibbonMenuButton>
              <div className="draft-ribbon-stack">
                <div className="draft-ribbon-row">
                  {tool(t.cut, <CutIcon />, () => onClipboard('cut'), undefined, !state.selection)}
                  {tool(t.copy, <CopyIcon />, () => onClipboard('copy'), undefined, !state.selection)}
                </div>
                <IconButton
                  variant={painter ? 'primary' : 'outline'}
                  size="sm"
                  aria-label={t.formatPainter}
                  aria-pressed={Boolean(painter)}
                  aria-keyshortcuts="Shift+Enter"
                  tooltip={
                    locale === 'pl'
                      ? 'Kliknij, aby skopiować formatowanie raz. Dwuklik lub Shift+Enter włącza tryb wielokrotny. Esc kończy kopiowanie.'
                      : 'Click to copy formatting once. Double-click or Shift+Enter to keep painting. Esc cancels.'
                  }
                  icon={<PaintbrushIcon />}
                  disabled={!state.selection}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => (painter ? setPainter(undefined) : startPainter(false))}
                  onDoubleClick={() => startPainter(true)}
                  onKeyDown={(event) => {
                    if (event.shiftKey && (event.key === 'Enter' || event.key === ' ')) {
                      event.preventDefault()
                      startPainter(true)
                    }
                  }}
                />
              </div>
            </ToolbarGroup>
            <ToolbarGroup
              label={locale === 'pl' ? 'Czcionka' : 'Font'}
              caption={locale === 'pl' ? 'Czcionka' : 'Font'}
              className="draft-ribbon-font draft-ribbon-stack-group"
            >
              <div className="draft-ribbon-row">
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
                <span className="draft-font-unit">pt</span>
              </div>
              <div className="draft-ribbon-row">
                {tool(
                  t.bold,
                  <strong aria-hidden="true">B</strong>,
                  () => toggleStyleEmphasis(editor, 'bold'),
                  state.bold,
                )}
                {tool(
                  t.italic,
                  <em aria-hidden="true">I</em>,
                  () => toggleStyleEmphasis(editor, 'italic'),
                  state.italic,
                )}
                {tool(
                  t.underline,
                  <u aria-hidden="true">U</u>,
                  () => editor.chain().focus().toggleUnderline().run(),
                  state.underline,
                )}
                <RibbonMenuButton
                  variant="outline"
                  presentation="icon"
                  label={t.color}
                  icon={<DraftIcon name="textColor" />}
                  keepOpen
                >
                  {' '}
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
                </RibbonMenuButton>
                <RibbonMenuButton
                  variant="outline"
                  presentation="icon"
                  label={t.highlightColor}
                  icon={<DraftIcon name="highlight" />}
                  keepOpen
                >
                  {' '}
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
                </RibbonMenuButton>{' '}
                {tool(t.clearFormatting, <EraserIcon />, () => clearDirectFormatting(editor))}
                <RibbonMenuButton
                  variant="outline"
                  label="Aa"
                  optionsLabel={locale === 'pl' ? 'Więcej formatowania' : 'More formatting'}
                  keepOpen
                >
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
                </RibbonMenuButton>
              </div>
            </ToolbarGroup>
            <ToolbarGroup label={t.paragraphGroup} caption={t.paragraphGroup} className="draft-ribbon-stack-group">
              <div className="draft-ribbon-row">
                {tool(
                  t.formattingMarks,
                  <span aria-hidden="true">¶</span>,
                  () => onShowFormattingMarks?.(!showFormattingMarks),
                  showFormattingMarks,
                )}
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
              </div>
              <div className="draft-ribbon-row">
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
                <RibbonMenuButton
                  variant="outline"
                  label="↕"
                  optionsLabel={locale === 'pl' ? 'Opcje akapitu' : 'Paragraph options'}
                  keepOpen
                >
                  {tool(
                    t.blockquote,
                    <QuoteIcon />,
                    () => editor.chain().focus().toggleBlockquote().run(),
                    state.quote,
                  )}{' '}
                  {tool(t.paragraphSettings, <span aria-hidden="true">¶</span>, () => {
                    // The keep-open menu unmounts when the dialog takes focus. Restore to its durable trigger.
                    const label = locale === 'pl' ? 'Opcje akapitu' : 'Paragraph options'
                    Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-expanded]'))
                      .find((button) => button.getAttribute('aria-label') === label)
                      ?.focus()
                    onParagraphDialog?.()
                  })}
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
                </RibbonMenuButton>
              </div>
            </ToolbarGroup>
            <ToolbarGroup
              label={locale === 'pl' ? 'Style' : 'Styles'}
              caption={locale === 'pl' ? 'Style' : 'Styles'}
              className=""
            >
              <StylePicker editor={editor} locale={locale} gallery />
            </ToolbarGroup>
            <ToolbarGroup
              label={locale === 'pl' ? 'Edycja' : 'Editing'}
              caption={locale === 'pl' ? 'Edycja' : 'Editing'}
              className="draft-ribbon-stack-group"
            >
              <Button size="sm" variant="outline" icon={<SearchIcon />} onClick={onFind}>
                {t.find}
              </Button>
              <Button size="sm" variant="outline" icon={<ReplaceIcon />} onClick={onReplace}>
                {t.replace}
              </Button>
            </ToolbarGroup>
          </ControlsBar>
        )}

        {activeTab === 'layout' && (
          <ControlsBar
            className="allsuite-editor-toolbar allsuite-ribbon-toolbar draft-toolbar"
            role="toolbar"
            aria-label={t.layout}
          >
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
          <ControlsBar
            className="allsuite-editor-toolbar allsuite-ribbon-toolbar draft-toolbar draft-toolbar--view"
            role="toolbar"
            aria-label={t.view}
          >
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
          <ControlsBar
            className="allsuite-editor-toolbar allsuite-ribbon-toolbar draft-toolbar"
            role="toolbar"
            aria-label={t.review}
          >
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
          </ControlsBar>
        )}
      </div>
    </div>
  )
}
