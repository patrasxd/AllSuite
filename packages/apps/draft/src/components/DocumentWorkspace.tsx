import { TableTools } from './TableTools'
import { LinkDialog, ReferencesDialog, ReferenceTools } from './ReferenceTools'
import { NavigationPanel } from './NavigationPanel'
import { exportLabels } from './ExportMenu'
import { PageSetupDialog, pageLabels } from './PageSetupDialog'
import {
  DEFAULT_PAGE_SETUP,
  orientPage,
  pagePreset,
  presetPage,
  readPageSetup,
  type PageSetup,
} from '../engine/page-setup'
import { setPageSetup } from '../editor/page-setup'
import type { ExportFormat } from '../engine/export/model'
import { useEffect, useRef, useState } from 'react'
import { useEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { Slice } from '@tiptap/pm/model'
import { closeHistory } from '@tiptap/pm/history'
import { EditorState } from '@tiptap/pm/state'
import {
  Alert,
  Button,
  CheckIcon,
  CloseIcon,
  Dialog,
  FullBleedLayout,
  StatsHeader,
  Text,
  safeGetJSON,
  safeSetJSON,
} from '@all/ui'
import { editorExtensions } from '../editor/extensions'
import { setFormattingMarks } from '../editor/formatting-marks'
import { setDocumentColumns } from '../editor/paragraph-commands'
import { sanitizeClipboardHTML } from '../editor/paste'
import { copySelection, pasteFromClipboard, pasteImageFromClipboard } from '../editor/clipboard'
import { insertImageContent } from '../editor/image-insertion'
import { DEFAULT_IMAGE_MAX_EDGE, type ImageOptions } from '../engine/images'
import { ImageInsertDialog, ImageTools, imageLabels } from './ImageTools'
import { plainTextParagraphs } from '../engine/formatting'
import { countText } from '../engine/stats'
import { loadDocumentFont, loadDocumentFonts } from '../engine/fonts'
import { textBlockChange } from '../editor/text-block-change'
import { normalizeDocumentLanguage } from '../engine/language'
import { autoformatReplacement, isBlockAutoformatTrigger } from '../engine/autoformat'
import { emptyDocument, type DraftDocument, type ImportResult } from '../engine/document-model'
import {
  chooseFile,
  chooseSaveHandle,
  docxName,
  download,
  readDocument,
  writeToHandle,
  type FileHandle,
} from '../engine/files'
import { EditorToolbar } from './EditorToolbar'
import { PageCanvas } from './PageCanvas'
import { PrintPreview, printLabels, type PreviewDocument } from './PrintPreview'
import { printLayoutHTML } from '../engine/print-layout'
import { applyReferenceSnapshot } from '../editor/references'
import { ParagraphDialog } from './ParagraphDialog'
import { FindReplacePanel } from './FindReplacePanel'
import { SymbolDialog } from './SymbolDialog'
import { CommentsPanel } from './CommentsPanel'
import { SuggestionsPanel } from './SuggestionsPanel'
import { EquationDialog } from './EquationDialog'
import { CodeBlockDialog } from './CodeBlockDialog'
import { StarterTemplatePicker } from './StarterTemplatePicker'
import { createStarterTemplate, type StarterTemplateId } from '../engine/starter-templates'
import { translations } from '../i18n'
import type { CodeLanguage } from '../editor/code-block'
import type { AppComponentProps } from '../types'
import { readCommentThreads, serializeCommentThreads, type CommentThread } from '../engine/comments'
import {
  readSuggestions,
  resolveSuggestions,
  setSuggestionTracking,
  type SuggestionSummary,
} from '../editor/suggestions'

export default function DocumentWorkspace({
  locale,
  isEink = false,
  setHeader,
  setIsDirty,
  isDirty,
}: AppComponentProps) {
  const t = translations[locale]
  const [dirty, setDirty] = useState(false)
  const [fileName, setFileName] = useState('Untitled')
  const [fileHandle, setFileHandle] = useState<FileHandle>()
  const [documentLanguage, setDocumentLanguage] = useState<string>()
  const [pendingImport, setPendingImport] = useState<ImportResult & { name: string; handle?: FileHandle }>()
  const [busy, setBusy] = useState<'opening' | 'saving' | null>(null)
  const [exporting, setExporting] = useState(false)
  const [preview, setPreview] = useState<PreviewDocument | null>(null)
  const exportAbort = useRef(new AbortController())
  const printWindows = useRef(new Set<Window>())
  const [progress, setProgress] = useState<number>()
  const [zoom, setZoom] = useState<import('../engine/page-view').PageZoom>(100)
  const [pageView, setPageView] = useState<import('../engine/page-view').PageView>('print')
  const [currentPage, setCurrentPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [pageSetup, updatePageSetup] = useState<PageSetup>({ ...DEFAULT_PAGE_SETUP })
  const [pageSetupDialog, setPageSetupDialog] = useState(false)
  const [initialStoryTarget, setInitialStoryTarget] = useState<string>()
  const [columns, setColumns] = useState(1)
  const [paragraphDialog, setParagraphDialog] = useState(false)
  const [linkDialog, setLinkDialog] = useState(false)
  const [referencesDialog, setReferencesDialog] = useState(false)
  const [navigation, setNavigation] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [trackChanges, setTrackChanges] = useState(false)
  const [suggestionAuthor, setSuggestionAuthor] = useState('Guest')
  const [currentSuggestions, setCurrentSuggestions] = useState<SuggestionSummary[]>([])
  const [commentAuthor, setCommentAuthor] = useState('')
  const [includeCommentsInPDF, setIncludeCommentsInPDF] = useState(false)
  const [currentComments, setCurrentComments] = useState<CommentThread[]>([])
  const [findMode, setFindMode] = useState<'find' | 'replace' | null>(null)
  const [symbolDialog, setSymbolDialog] = useState<'symbols' | 'emoji' | null>(null)
  const [equationDialog, setEquationDialog] = useState(false)
  const [codeBlockDialog, setCodeBlockDialog] = useState(false)
  const [starterTemplatePickerOpen, setStarterTemplatePickerOpen] = useState(false)
  const [imageDialog, setImageDialog] = useState(false)
  const [imageAltDialog, setImageAltDialog] = useState(false)
  const [imageBusy, setImageBusy] = useState(false)
  const [imageError, setImageError] = useState(false)
  const [imageOptions, setImageOptions] = useState<ImageOptions>(() => {
    const stored = safeGetJSON('allsuite:draft:image-options', { maxEdge: DEFAULT_IMAGE_MAX_EDGE, keepOriginal: false })
    return {
      maxEdge: Math.max(64, Math.min(16384, Number(stored?.maxEdge) || DEFAULT_IMAGE_MAX_EDGE)),
      keepOriginal: stored?.keepOriginal === true,
    }
  })
  const imageOptionsRef = useRef(imageOptions)
  imageOptionsRef.current = imageOptions
  const imageAbort = useRef(new AbortController())
  const imageJobs = useRef(0)
  const [preferences, setPreferences] = useState(() => ({
    showRuler: true,
    showFormattingMarks: false,
    autoformat: true,
    hyphenation: false,
    ...safeGetJSON('allsuite:draft:view-preferences', {}),
  }))
  const [notice, setNotice] = useState<
    'clipboardError' | 'imagePasteHint' | 'fileError' | 'exportError' | 'printBlocked' | 'printColumns' | null
  >(null)
  const [counts, setCounts] = useState({
    document: countText(''),
    selection: undefined as ReturnType<typeof countText> | undefined,
  })
  const plainPasteUntil = useRef(0)
  const autoformatEnabled = useRef(preferences.autoformat)
  const currentLocale = useRef(locale)
  const suggestionAuthorRef = useRef(suggestionAuthor)
  const countCache = useRef<{ doc: Editor['state']['doc']; value: ReturnType<typeof countText> }>()
  const editorRef = useRef<Editor | null>(null)
  const commentSelection = useRef<{ from: number; to: number } | null>(null)
  const commentData = useRef('')
  autoformatEnabled.current = preferences.autoformat
  currentLocale.current = locale
  suggestionAuthorRef.current = suggestionAuthor
  const dirtyCallback = useRef(setIsDirty)
  dirtyCallback.current = setIsDirty
  const hasUnsavedChanges = dirty || Boolean(isDirty)
  useEffect(() => {
    if (exportAbort.current.signal.aborted) exportAbort.current = new AbortController()
    const windows = printWindows.current
    return () => {
      exportAbort.current.abort()
      for (const target of windows) if (!target.closed) target.close()
      windows.clear()
    }
  }, [])
  function updateCounts(current: Editor) {
    if (countCache.current?.doc !== current.state.doc)
      countCache.current = { doc: current.state.doc, value: countText(current.getText({ blockSeparator: '\n' })) }
    const { from, to } = current.state.selection
    rememberCommentSelection(current)
    const selectionText = from === to ? '' : current.state.doc.textBetween(from, to, '\n')
    setCounts({ document: countCache.current.value, selection: selectionText ? countText(selectionText) : undefined })
  }
  function rememberCommentSelection(current: Editor) {
    const selection = current.state.selection
    const text = selection.empty ? '' : current.state.doc.textBetween(selection.from, selection.to)
    commentSelection.current = text.trim() ? { from: selection.from, to: selection.to } : null
  }
  function syncComments(current: Editor, force = false) {
    const value = current.state.doc.attrs.comments
    const signature = typeof value === 'string' ? value : JSON.stringify(value ?? null)
    if (!force && commentData.current === signature) return
    commentData.current = signature
    setCurrentComments(readCommentThreads(value))
  }
  function syncSuggestions(current: Editor) {
    setCurrentSuggestions(readSuggestions(current.state.doc))
  }
  const editor = useEditor({
    extensions: editorExtensions({
      requestPlainPaste: () => {
        plainPasteUntil.current = Date.now() + 1500
      },
      requestLink: () => setLinkDialog(true),
      requestImageEdit: () => setImageAltDialog(true),
      requestComment: () => {
        if (editorRef.current) rememberCommentSelection(editorRef.current)
        setCommentsOpen(true)
      },
      toggleComments: () => {
        if (editorRef.current) rememberCommentSelection(editorRef.current)
        setCommentsOpen((current) => !current)
      },
      getSuggestionAuthor: () => suggestionAuthorRef.current,
      getLocale: () => currentLocale.current,
      onPages: setPages,
    }),
    content: '<p></p>',
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-label': t.editor,
        'aria-multiline': 'true',
        spellcheck: 'true',
        lang: locale,
      },
      transformPastedHTML: sanitizeClipboardHTML,
      handlePaste: (view, event) => {
        if (plainPasteUntil.current < Date.now()) {
          const files = Array.from(event.clipboardData?.files || [])
          if (files.length) {
            void addImages(files)
            return true
          }
          const svg = event.clipboardData?.getData('image/svg+xml')
          if (svg) {
            void addImages([new Blob([svg], { type: 'image/svg+xml' })])
            return true
          }
          const html = event.clipboardData?.getData('text/html')
          if (html) {
            const safe = sanitizeClipboardHTML(html)
            if (safe.includes('<img')) {
              void addImages(safe)
              return true
            }
          }
          return false
        }
        plainPasteUntil.current = 0
        const text = event.clipboardData?.getData('text/plain')
        if (text === undefined) return false
        if (!text) return true
        const nodes = plainTextParagraphs(text).map((node) => view.state.schema.nodeFromJSON(node))
        const fragment = view.state.schema.node('doc', null, nodes).content
        view.dispatch(view.state.tr.replaceSelection(new Slice(fragment, 0, 0)))
        return true
      },
      handleTextInput: (view, from, to, input) => {
        const start = view.state.doc.resolve(from).start()
        const textBefore = view.state.doc.textBetween(start, from, '', '')
        if (!autoformatEnabled.current && isBlockAutoformatTrigger(textBefore, input)) {
          view.dispatch(view.state.tr.insertText(input, from, to))
          return true
        }
        if (!autoformatEnabled.current) return false
        const replacement = autoformatReplacement(textBefore, input, currentLocale.current)
        if (!replacement) return false
        view.dispatch(view.state.tr.insertText(input, from, to))
        const insertedTo = from + input.length
        view.dispatch(
          closeHistory(
            view.state.tr.insertText(
              replacement.insert,
              insertedTo - replacement.deleteBefore - input.length,
              insertedTo,
            ),
          ),
        )
        return true
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false
        const files = Array.from(event.dataTransfer?.files || [])
        if (!files.length) return false
        const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.from
        void addImages(files, '', position)
        return true
      },
    },
    onUpdate: ({ editor: current, transaction }) => {
      setDirty(true)
      dirtyCallback.current?.(true)
      updateCounts(current)
      setColumns(Number(current.state.doc.attrs.columns) || 1)
      syncComments(current)
      syncSuggestions(current)
      const page = readPageSetup({ attrs: current.state.doc.attrs })
      updatePageSetup((previous) => (JSON.stringify(previous) === JSON.stringify(page) ? previous : page))
      const changed = textBlockChange(transaction.before, transaction.doc)
      if (changed)
        changed.node.forEach((child) =>
          child.marks.forEach((mark) => {
            if (mark.type.name === 'textStyle' && typeof mark.attrs.fontFamily === 'string')
              void loadDocumentFont(mark.attrs.fontFamily)
          }),
        )
      else void loadDocumentFonts(current.getJSON() as DraftDocument)
    },
    onSelectionUpdate: ({ editor: current }) => updateCounts(current),
  })
  editorRef.current = editor
  function updateComments(transform: (current: CommentThread[]) => CommentThread[]) {
    if (!editor) return
    const next = transform(readCommentThreads(editor.state.doc.attrs.comments))
    editor.view.dispatch(editor.state.tr.setDocAttribute('comments', serializeCommentThreads(next)))
  }
  function addComment(text: string) {
    if (!editor) return
    const range = commentSelection.current
    const mark = editor.schema.marks.comment
    if (!range || !mark || range.to > editor.state.doc.content.size) return
    const id = `comment-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`
    const author = commentAuthor.trim().slice(0, 200) || 'Guest'
    const thread: CommentThread = { id, author, text: text.trim().slice(0, 20_000), resolved: false, replies: [] }
    const comments = readCommentThreads(editor.state.doc.attrs.comments)
    const transaction = editor.state.tr
      .addMark(range.from, range.to, mark.create({ id }))
      .setDocAttribute('comments', serializeCommentThreads([...comments, thread]))
    editor.view.dispatch(transaction)
    commentSelection.current = null
    setCommentsOpen(true)
  }
  function focusComment(id: string) {
    if (!editor) return
    let from: number | undefined
    let to: number | undefined
    editor.state.doc.descendants((node, position) => {
      if (!node.isText || !node.marks.some((mark) => mark.type.name === 'comment' && mark.attrs.id === id)) return true
      from ??= position
      to = position + node.nodeSize
      return false
    })
    if (from !== undefined && to !== undefined) {
      editor.commands.setTextSelection({ from, to })
      editor.commands.focus()
      editor.commands.scrollIntoView()
    }
  }
  function addReply(id: string, text: string) {
    const author = commentAuthor.trim().slice(0, 200) || 'Guest'
    updateComments((comments) =>
      comments.map((thread) =>
        thread.id === id
          ? {
              ...thread,
              replies: [
                ...thread.replies,
                {
                  id: `reply-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`,
                  author,
                  text: text.trim().slice(0, 20_000),
                },
              ],
            }
          : thread,
      ),
    )
  }
  function toggleCommentResolved(id: string) {
    updateComments((comments) =>
      comments.map((thread) => (thread.id === id ? { ...thread, resolved: !thread.resolved } : thread)),
    )
  }
  async function addImages(source: Blob[] | string, alt = '', position?: number) {
    const signal = imageAbort.current.signal
    imageJobs.current++
    setImageBusy(true)
    setImageError(false)
    try {
      await insertImageContent(editor, source, imageOptionsRef.current, signal, alt, position)
    } catch {
      if (!signal.aborted) setImageError(true)
    } finally {
      if (!signal.aborted) {
        imageJobs.current--
        setImageBusy(imageJobs.current > 0)
      }
    }
  }
  useEffect(() => {
    safeSetJSON('allsuite:draft:image-options', imageOptions)
  }, [imageOptions])
  useEffect(() => {
    if (imageAbort.current.signal.aborted) imageAbort.current = new AbortController()
    return () => imageAbort.current.abort()
  }, [])
  useEffect(() => {
    safeSetJSON('allsuite:draft:view-preferences', preferences)
    if (editor) setFormattingMarks(editor, preferences.showFormattingMarks)
  }, [editor, preferences])
  useEffect(() => {
    editor?.setOptions({
      editorProps: {
        ...editor.options.editorProps,
        attributes: {
          role: 'textbox',
          'aria-label': t.editor,
          'aria-multiline': 'true',
          spellcheck: 'true',
          lang: documentLanguage || locale,
        },
      },
    })
  }, [editor, locale, t.editor, documentLanguage])
  useEffect(() => {
    setHeader?.(
      focusMode ? null : (
        <StatsHeader
          items={[
            { key: 'words', label: t.words, value: counts.document.words },
            { key: 'characters', label: t.characters, value: counts.document.charactersWithSpaces },
          ]}
        />
      ),
    )
    return () => setHeader?.(null)
  }, [setHeader, focusMode, counts.document.words, counts.document.charactersWithSpaces, t.words, t.characters])
  useEffect(() => {
    if (!focusMode) return
    const leaveFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setFocusMode(false)
      requestAnimationFrame(() => editor?.commands.focus())
    }
    window.addEventListener('keydown', leaveFocus, true)
    return () => window.removeEventListener('keydown', leaveFocus, true)
  }, [editor, focusMode])
  useEffect(() => {
    if (!hasUnsavedChanges) return
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [hasUnsavedChanges])
  function replaceDocument(result: ImportResult & { name: string; handle?: FileHandle }) {
    imageAbort.current.abort()
    imageAbort.current = new AbortController()
    imageJobs.current = 0
    setImageBusy(false)
    setImageError(false)
    setImageAltDialog(false)
    setLinkDialog(false)
    setReferencesDialog(false)
    setCommentsOpen(false)
    commentSelection.current = null
    setPageSetupDialog(false)
    // A replacement recreates pagination's plugin view, whose initial count is one.
    // Reset the React chrome too: an empty document does not emit a count change.
    setPages(1)
    setCurrentPage(1)
    void loadDocumentFonts(result.document)
    // A replacement document must release the preceding document's image/history graph.
    editor.view.updateState(
      EditorState.create({
        schema: editor.schema,
        doc: editor.schema.nodeFromJSON(result.document),
        plugins: editor.state.plugins,
      }),
    )
    syncComments(editor, true)
    syncSuggestions(editor)
    setSuggestionsOpen(false)
    setSuggestionTracking(editor, trackChanges)
    setFormattingMarks(editor, preferences.showFormattingMarks)
    editor.commands.setTextSelection(1)
    updateCounts(editor)
    setFileName(result.name)
    setFileHandle(result.handle)
    setDocumentLanguage(normalizeDocumentLanguage(result.language))
    setColumns(Number(result.document.attrs?.columns) || 1)
    updatePageSetup(readPageSetup(result.document))
    setDirty(false)
    dirtyCallback.current?.(false)
  }
  function changeDocumentLanguage(value: string) {
    const normalized = normalizeDocumentLanguage(value)
    if (!normalized || normalized === documentLanguage) return
    setDocumentLanguage(normalized)
    setDirty(true)
    dirtyCallback.current?.(true)
  }
  async function openDocument() {
    if (hasUnsavedChanges && !window.confirm(t.discardChanges)) return
    try {
      setBusy('opening')
      setProgress(0)
      setNotice(null)
      const selected = await chooseFile()
      if (!selected) return
      const result = await readDocument(selected.file, selected.handle, setProgress)
      if (result.unsupported.length) setPendingImport(result)
      else replaceDocument(result)
    } catch {
      setNotice('fileError')
    } finally {
      setBusy(null)
      setProgress(undefined)
    }
  }
  function newDocument() {
    if (hasUnsavedChanges && !window.confirm(t.discardChanges)) return
    setStarterTemplatePickerOpen(true)
  }
  function chooseBlankDocument() {
    replaceDocument({ document: emptyDocument(), name: 'Untitled', unsupported: [] })
    setStarterTemplatePickerOpen(false)
  }
  function chooseStarterTemplate(id: StarterTemplateId) {
    const template = createStarterTemplate(id, locale)
    replaceDocument({ document: template.document, name: template.fileName, unsupported: [] })
    setStarterTemplatePickerOpen(false)
  }
  async function saveDocument(saveAs = false) {
    try {
      setBusy('saving')
      setNotice(null)
      const snapshot = editor.getJSON()
      const { prepareReferenceExport } = await import('../browser/reference-layout')
      const updated = await prepareReferenceExport(snapshot as DraftDocument, exportAbort.current.signal)
      const { exportDocx } = await import('../engine/docx/export')
      const blob = await exportDocx(updated, documentLanguage || locale)
      let handle = fileHandle
      if (saveAs || !handle) handle = await chooseSaveHandle(docxName(fileName))
      if (handle) {
        await writeToHandle(handle, blob)
        setFileHandle(handle)
        setFileName(handle.name)
      } else download(blob, docxName(fileName))
      if (JSON.stringify(editor.getJSON()) === JSON.stringify(snapshot)) {
        setDirty(false)
        dirtyCallback.current?.(false)
      }
    } catch {
      setNotice('fileError')
    } finally {
      setBusy(null)
    }
  }
  async function exportDocument(format: ExportFormat | 'print' | 'preview') {
    const signal = exportAbort.current.signal
    let snapshot = editor.getJSON() as DraftDocument
    const sourceDocument = editor.state.doc
    let target: Window | null = null
    const close = () => {
      if (target && printWindows.current.delete(target) && !target.closed) target.close()
    }
    setExporting(true)
    setNotice(null)
    try {
      // Open during the trusted click, before importing converters or decoding fonts.
      if (format === 'print') {
        target = window.open('', '_blank')
        if (!target) throw new Error('printBlocked')
        target.opener = null
        printWindows.current.add(target)
        target.document.body.textContent = exportLabels[locale].preparing
      }
      const options = {
        title: fileName.replace(/\.(docx|odt|txt|md)$/i, '') || 'Untitled',
        language: documentLanguage || locale,
      }
      if (format === 'pdf' || format === 'print' || format === 'preview') {
        const browser = await import('../browser/export')
        if (columns !== 1) {
          if (format !== 'print') throw new Error('printColumns')
          // Continuous multi-column documents retain their existing semantic print path.
          const engine = await import('../engine/export')
          const fonts = await browser.loadExportFonts(snapshot, signal)
          await browser.printHTML(
            target!,
            engine.exportPDF(snapshot, { ...options, fonts, fontLicense: browser.fontLicense }),
            signal,
            close,
          )
          return
        }
        const { capturePrintLayout } = await import('../browser/print-layout')
        const includeComments = format === 'preview' || format === 'print' || (format === 'pdf' && includeCommentsInPDF)
        const value =
          preview && (format !== 'pdf' || includeCommentsInPDF)
            ? preview
            : {
                layout: await capturePrintLayout(snapshot, options.title, options.language, signal, {
                  hyphenation: preferences.hyphenation,
                  includeComments,
                  onResolved: (resolved) => {
                    if (!signal.aborted && !editor.isDestroyed && editor.state.doc === sourceDocument)
                      applyReferenceSnapshot(editor, resolved)
                  },
                }),
                fonts: await browser.loadExportFonts(snapshot, signal),
                license: browser.fontLicense,
              }
        if (signal.aborted || target?.closed) {
          close()
          return
        }
        if (format === 'preview') setPreview(value)
        else if (format === 'print')
          await browser.printHTML(target!, printLayoutHTML(value.layout, value.fonts, value.license), signal, close)
        else {
          const { exportPaginatedPDF } = await import('../engine/paginated-pdf')
          const fonts = await browser.loadExportFonts(snapshot, signal, 'woff')
          const bytes = await exportPaginatedPDF(value.layout, fonts, signal)
          if (!signal.aborted)
            download(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), options.title + '.pdf')
        }
        return
      }
      const engine = await import('../engine/export')
      const { prepareReferenceExport } = await import('../browser/reference-layout')
      snapshot = await prepareReferenceExport(snapshot, signal)
      if (format === 'odt') {
        const { exportOdt } = await import('../engine/odt/export')
        const bytes = exportOdt(snapshot, options.language)
        if (!signal.aborted)
          download(
            new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/vnd.oasis.opendocument.text' }),
            engine.exportFileName(fileName, format),
          )
      } else if (format === 'html') {
        const browser = await import('../browser/export')
        const fonts = await browser.loadExportFonts(snapshot, signal)
        if (signal.aborted || target?.closed) {
          close()
          return
        }
        const configured = { ...options, fonts, fontLicense: browser.fontLicense }
        download(
          new Blob([engine.exportHTML(snapshot, configured)], { type: 'text/html;charset=utf-8' }),
          engine.exportFileName(fileName, format),
        )
      } else {
        if (signal.aborted) return
        const content = format === 'markdown' ? engine.exportMarkdown(snapshot) : engine.exportText(snapshot)
        download(
          new Blob([content], {
            type: format === 'markdown' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8',
          }),
          engine.exportFileName(fileName, format),
        )
      }
    } catch (error) {
      const canceled = signal.aborted || target?.closed
      close()
      if (!canceled)
        setNotice(
          (error as Error).message === 'printBlocked'
            ? 'printBlocked'
            : (error as Error).message === 'printColumns'
              ? 'printColumns'
              : 'exportError',
        )
    } finally {
      if (!signal.aborted) setExporting(false)
    }
  }
  useEffect(() => {
    const keyboardUtilities = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      const key = event.key.toLowerCase()
      if (key === 'p') {
        event.preventDefault()
        void exportDocument('print')
        return
      }
      if (preview) return
      if (key === 's') {
        event.preventDefault()
        void saveDocument()
      }
      if (key === 'f' || key === 'h') {
        event.preventDefault()
        setFindMode(key === 'h' ? 'replace' : 'find')
      }
    }
    window.addEventListener('keydown', keyboardUtilities)
    return () => window.removeEventListener('keydown', keyboardUtilities)
  })
  async function clipboard(action: 'cut' | 'copy' | 'paste' | 'plain' | 'pasteImage') {
    if (!editor) return
    setNotice(null)
    try {
      if (action === 'cut' || action === 'copy') await copySelection(editor, action === 'cut')
      else if (action === 'pasteImage') {
        if (!(await pasteImageFromClipboard(editor, (source) => addImages(source)))) setNotice('imagePasteHint')
      } else await pasteFromClipboard(editor, action === 'plain', (source) => addImages(source))
    } catch {
      setNotice('clipboardError')
    }
  }
  function enterFocusMode() {
    setNavigation(false)
    setCommentsOpen(false)
    setSuggestionsOpen(false)
    setFindMode(null)
    setParagraphDialog(false)
    setLinkDialog(false)
    setReferencesDialog(false)
    setPageSetupDialog(false)
    setSymbolDialog(null)
    setEquationDialog(false)
    setCodeBlockDialog(false)
    setImageDialog(false)
    setImageAltDialog(false)
    setStarterTemplatePickerOpen(false)
    setPendingImport(undefined)
    setFocusMode(true)
    requestAnimationFrame(() => editor?.commands.focus())
  }
  function leaveFocusMode() {
    setFocusMode(false)
    requestAnimationFrame(() => editor?.commands.focus())
  }
  if (!editor) return null
  return (
    <>
      {preview && (
        <PrintPreview
          value={preview}
          locale={locale}
          busy={exporting}
          error={notice ? (notice === 'printColumns' ? printLabels[locale].columns : t[notice]) : undefined}
          onClose={() => {
            setPreview(null)
            requestAnimationFrame(() => editor.commands.focus())
          }}
          onPrint={() => {
            void exportDocument('print')
          }}
          onPDF={() => {
            void exportDocument('pdf')
          }}
          includeCommentsInPDF={includeCommentsInPDF}
          onToggleCommentsInPDF={() => setIncludeCommentsInPDF((current) => !current)}
        />
      )}
      <FullBleedLayout
        className={`draft-workspace${preview ? ' draft-workspace--preview-hidden' : ''}${focusMode ? ' draft-workspace--focus' : ''}`}
        footer={
          focusMode ? undefined : (
            <div className="draft-status-bar">
              <Text as="span" variant="caption" role="status" title={t.unsavedHint}>
                {dirty ? t.dirty : t.clean}
              </Text>
              <Text as="span" variant="caption">
                {t.words}: {counts.document.words}
              </Text>
              <Text as="span" variant="caption">
                {t.charactersWithSpaces}: {counts.document.charactersWithSpaces}
              </Text>
              <Text as="span" variant="caption">
                {t.charactersWithoutSpaces}: {counts.document.charactersWithoutSpaces}
              </Text>
              {counts.selection && (
                <Text as="span" variant="caption">
                  {t.selection}: {counts.selection.words} {t.words.toLowerCase()},{' '}
                  {counts.selection.charactersWithSpaces} {t.characters.toLowerCase()}
                </Text>
              )}
              <Text as="span" variant="caption">
                {t.pages}: {columns === 1 && pageView === 'print' ? pages : '—'}
              </Text>
              {columns === 1 && pageView === 'print' && (
                <Text as="span" variant="caption">
                  {locale === 'pl' ? 'Bieżąca strona' : 'Current page'}: {Math.min(currentPage, pages)}
                </Text>
              )}
            </div>
          )
        }
      >
        <StarterTemplatePicker
          open={starterTemplatePickerOpen}
          locale={locale}
          onClose={() => setStarterTemplatePickerOpen(false)}
          onBlank={chooseBlankDocument}
          onSelect={chooseStarterTemplate}
        />
        {!focusMode && (
          <EditorToolbar
            editor={editor}
            locale={locale}
            zoom={zoom}
            onZoom={setZoom}
            pageView={pageView}
            onPageView={setPageView}
            pageSize={pagePreset(pageSetup)}
            onPageSize={(preset) => {
              if (preset === 'custom' || !setPageSetup(editor, presetPage(pageSetup, preset))) setPageSetupDialog(true)
            }}
            orientation={pageSetup.orientation}
            onOrientation={(orientation) => {
              if (!setPageSetup(editor, orientPage(pageSetup, orientation as PageSetup['orientation'])))
                setPageSetupDialog(true)
            }}
            onPageSetup={() => setPageSetupDialog(true)}
            onNew={newDocument}
            onOpen={() => {
              void openDocument()
            }}
            onSave={() => {
              void saveDocument()
            }}
            onSaveAs={() => {
              void saveDocument(true)
            }}
            saving={busy === 'saving' || exporting}
            onExport={(format) => {
              void exportDocument(format)
            }}
            onPrint={() => {
              void exportDocument('print')
            }}
            onPrintPreview={() => {
              void exportDocument('preview')
            }}
            onParagraphDialog={() => setParagraphDialog(true)}
            showRuler={preferences.showRuler}
            onShowRuler={(showRuler) => setPreferences((current) => ({ ...current, showRuler }))}
            showFormattingMarks={preferences.showFormattingMarks}
            onShowFormattingMarks={(showFormattingMarks) =>
              setPreferences((current) => ({ ...current, showFormattingMarks }))
            }
            autoformat={preferences.autoformat}
            onAutoformat={(autoformat) => setPreferences((current) => ({ ...current, autoformat }))}
            hyphenation={preferences.hyphenation}
            onHyphenation={(hyphenation) => setPreferences((current) => ({ ...current, hyphenation }))}
            columns={columns}
            onColumns={(value) => {
              setDocumentColumns(editor, value)
              setColumns(value)
            }}
            onFind={() => setFindMode('find')}
            onReplace={() => setFindMode('replace')}
            onSymbols={() => setSymbolDialog('symbols')}
            onEmoji={() => setSymbolDialog('emoji')}
            onImage={() => setImageDialog(true)}
            onEquation={() => setEquationDialog(true)}
            onCodeBlock={() => setCodeBlockDialog(true)}
            onLink={() => setLinkDialog(true)}
            onReferences={() => setReferencesDialog(true)}
            onNavigation={() => setNavigation((current) => !current)}
            showNavigation={navigation}
            onFocusMode={enterFocusMode}
            documentLanguage={documentLanguage || locale}
            onDocumentLanguage={changeDocumentLanguage}
            commentsOpen={commentsOpen}
            commentCount={currentComments.length}
            onToggleCommentsInPDF={() => setIncludeCommentsInPDF((current) => !current)}
            includeCommentsInPDF={includeCommentsInPDF}
            onToggleComments={() => setCommentsOpen((current) => !current)}
            trackChanges={trackChanges}
            suggestionsOpen={suggestionsOpen}
            suggestionCount={currentSuggestions.length}
            onToggleTracking={(enabled) => {
              setTrackChanges(enabled)
              setSuggestionTracking(editor, enabled)
            }}
            onToggleSuggestions={() => {
              setCommentsOpen(false)
              setSuggestionsOpen((current) => !current)
            }}
            onAddComment={() => {
              rememberCommentSelection(editor)
              setCommentsOpen(true)
            }}
            onClipboard={(action) => {
              void clipboard(action)
            }}
          />
        )}
        {!focusMode && <TableTools editor={editor} locale={locale} />}
        {!focusMode && <ReferenceTools editor={editor} locale={locale} onEditLink={() => setLinkDialog(true)} />}
        {!focusMode && (
          <LinkDialog editor={editor} locale={locale} open={linkDialog} onClose={() => setLinkDialog(false)} />
        )}
        {!focusMode && (
          <ReferencesDialog
            editor={editor}
            locale={locale}
            open={referencesDialog}
            onClose={() => setReferencesDialog(false)}
          />
        )}
        {!focusMode && (
          <ImageTools editor={editor} locale={locale} editAlt={imageAltDialog} onEditAlt={setImageAltDialog} />
        )}
        {!focusMode && (
          <ImageInsertDialog
            open={imageDialog}
            onClose={() => setImageDialog(false)}
            locale={locale}
            options={imageOptions}
            onOptions={setImageOptions}
            onInsert={(files, alt) => addImages(files, alt)}
            busy={imageBusy}
          />
        )}
        {!focusMode && imageBusy && <Text role="status">{imageLabels[locale].processing}</Text>}
        {!focusMode && imageError && (
          <Alert variant="info" onClose={() => setImageError(false)}>
            {imageLabels[locale].error}
          </Alert>
        )}
        {!focusMode && findMode && (
          <FindReplacePanel
            editor={editor}
            locale={locale}
            mode={findMode}
            onModeChange={setFindMode}
            onClose={() => setFindMode(null)}
          />
        )}
        {!focusMode && notice && (
          <Alert variant="info" onClose={() => setNotice(null)}>
            {notice === 'printColumns' ? printLabels[locale].columns : t[notice]}
          </Alert>
        )}
        {!focusMode && busy === 'opening' && (
          <Alert variant="info">
            {t.opening}
            {progress !== undefined ? ` ${progress}%` : ''}
          </Alert>
        )}
        {!focusMode && busy === 'saving' && <Alert variant="info">{t.saving}</Alert>}
        {!focusMode && exporting && <Text role="status">{exportLabels[locale].preparing}</Text>}
        <div className="draft-content-region">
          {!focusMode && (
            <NavigationPanel editor={editor} locale={locale} open={navigation} onClose={() => setNavigation(false)} />
          )}
          <PageCanvas
            onEditStories={(kind, variant) => {
              setInitialStoryTarget(`${kind}:${variant}`)
              setPageSetupDialog(true)
            }}
            editor={editor}
            page={pageSetup}
            pages={pages}
            zoom={zoom}
            onZoom={setZoom}
            view={pageView}
            onCurrentPage={setCurrentPage}
            isEink={isEink}
            locale={locale}
            ruler={!focusMode && preferences.showRuler}
            hyphenation={preferences.hyphenation}
            columns={columns}
            comments={currentComments}
            onSelectComment={focusComment}
          />
          {!focusMode && commentsOpen && (
            <CommentsPanel
              editor={editor}
              locale={locale}
              threads={currentComments}
              author={commentAuthor}
              onAuthorChange={setCommentAuthor}
              canComment={Boolean(commentSelection.current)}
              onAdd={addComment}
              onReply={addReply}
              onToggleResolved={toggleCommentResolved}
              onClose={() => setCommentsOpen(false)}
            />
          )}
          {!focusMode && suggestionsOpen && (
            <SuggestionsPanel
              editor={editor}
              locale={locale}
              suggestions={currentSuggestions}
              author={suggestionAuthor}
              tracking={trackChanges}
              onAuthorChange={setSuggestionAuthor}
              onTrackingChange={(enabled) => {
                setTrackChanges(enabled)
                setSuggestionTracking(editor, enabled)
              }}
              onResolve={(ids, decision) => resolveSuggestions(editor, ids, decision)}
              onClose={() => setSuggestionsOpen(false)}
            />
          )}
          {focusMode && (
            <Button className="draft-focus-exit" size="md" variant="outline" onClick={leaveFocusMode}>
              {locale === 'pl' ? 'Zakończ tryb skupienia' : 'Exit focus mode'}
            </Button>
          )}
        </div>
        {!focusMode && (
          <ParagraphDialog
            editor={editor}
            locale={locale}
            open={paragraphDialog}
            onClose={() => setParagraphDialog(false)}
          />
        )}
        {!focusMode && pageSetupDialog && (
          <PageSetupDialog
            isEink={isEink}
            initialStoryTarget={initialStoryTarget}
            styleDefinitions={editor.state.doc.attrs.styleDefinitions}
            page={pageSetup}
            locale={locale}
            open={pageSetupDialog}
            onClose={() => {
              setPageSetupDialog(false)
              setInitialStoryTarget(undefined)
            }}
            onApply={(page) => setPageSetup(editor, page)}
          />
        )}
        {!focusMode && (
          <SymbolDialog
            editor={editor}
            locale={locale}
            open={Boolean(symbolDialog)}
            initialTab={symbolDialog || 'symbols'}
            onClose={() => setSymbolDialog(null)}
          />
        )}
        {!focusMode && (
          <EquationDialog
            open={equationDialog}
            locale={locale}
            onClose={() => setEquationDialog(false)}
            onInsert={(latex, displayMode) =>
              editor
                .chain()
                .focus()
                .insertContent({ type: displayMode ? 'mathBlock' : 'mathInline', attrs: { latex } })
                .run()
            }
          />
        )}
        {!focusMode && (
          <CodeBlockDialog
            open={codeBlockDialog}
            locale={locale}
            onClose={() => setCodeBlockDialog(false)}
            onInsert={(language: CodeLanguage | null) =>
              editor
                .chain()
                .focus()
                .setCodeBlock({ language: language || '' })
                .run()
            }
          />
        )}
        {!focusMode && (
          <Dialog
            open={Boolean(pendingImport)}
            onClose={() => setPendingImport(undefined)}
            title={t.importReport}
            description={t.importReportDescription}
          >
            <div className="draft-import-report">
              <ul>
                {pendingImport?.unsupported.map((item, index) => (
                  <li key={`${item.kind}-${index}`}>
                    {item.kind in pageLabels[locale]
                      ? pageLabels[locale][item.kind as keyof typeof pageLabels.en]
                      : item.kind.startsWith('chart')
                        ? item.kind
                            .replace(/converted to images$/, t.chartConverted)
                            .replace(/could not be rendered$/, t.chartFailed)
                        : item.kind}
                  </li>
                ))}
              </ul>
              <div className="draft-dialog-actions">
                <Button variant="secondary" size="sm" icon={<CloseIcon />} onClick={() => setPendingImport(undefined)}>
                  {t.cancel}
                </Button>
                <Button
                  size="sm"
                  icon={<CheckIcon />}
                  onClick={() => {
                    if (pendingImport) replaceDocument(pendingImport)
                    setPendingImport(undefined)
                  }}
                >
                  {t.continue}
                </Button>
              </div>
            </div>
          </Dialog>
        )}
      </FullBleedLayout>
    </>
  )
}
