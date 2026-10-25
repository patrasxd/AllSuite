import { AppHeader, Button, IconButton, RedoIcon, SaveIcon, UndoIcon, WorkspaceTabs } from '@all/ui'
import type { ComponentProps, HTMLAttributes, PointerEventHandler, ReactNode, Ref } from 'react'
import type { Locale } from './app-host'
import './editor-chrome.css'

/** AllSuite composition only: AllUI owns the controls; apps own every command. */
export function EditorHeader(props: ComponentProps<typeof AppHeader>) {
  return <AppHeader {...props} className={`allsuite-editor-header ${props.className ?? ''}`} />
}

export function EditorHeaderContent({
  filename,
  dirty,
  locale,
  actionsRef,
}: {
  filename: string
  dirty: boolean
  locale: Locale
  actionsRef: Ref<HTMLSpanElement>
}) {
  return (
    <span className="allsuite-editor-header-content">
      <span className="allsuite-editor-filename" title={filename}>
        {filename}
        {dirty && <span aria-label={locale === 'pl' ? 'Niezapisane zmiany' : 'Unsaved changes'}> ·</span>}
      </span>
      <span className="allsuite-editor-header-actions" ref={actionsRef} />
    </span>
  )
}

export interface EditorActions {
  undo: () => void
  redo: () => void
  save: () => void
  canUndo: boolean
  canRedo: boolean
  saving?: boolean
  labels: { undo: string; redo: string; save: string; group: string }
  onSavePointerDown?: PointerEventHandler<HTMLButtonElement>
}

export function EditorActionCluster({ actions, saveOnly = false }: { actions: EditorActions; saveOnly?: boolean }) {
  return (
    <div className="allsuite-editor-actions" role="group" aria-label={actions.labels.group}>
      {!saveOnly && (
        <>
          <IconButton
            aria-label={actions.labels.undo}
            icon={<UndoIcon />}
            size="sm"
            variant="outline"
            aria-keyshortcuts="Control+Z Meta+Z"
            disabled={!actions.canUndo}
            onMouseDown={(event) => event.preventDefault()}
            onClick={actions.undo}
          />
          <IconButton
            aria-label={actions.labels.redo}
            icon={<RedoIcon />}
            size="sm"
            variant="outline"
            aria-keyshortcuts="Control+Y Control+Shift+Z Meta+Y Meta+Shift+Z"
            disabled={!actions.canRedo}
            onMouseDown={(event) => event.preventDefault()}
            onClick={actions.redo}
          />
        </>
      )}
      <IconButton
        className="allsuite-editor-save"
        aria-label={actions.labels.save}
        icon={<SaveIcon />}
        size="sm"
        variant="outline"
        aria-keyshortcuts="Control+S Meta+S"
        disabled={actions.saving}
        onPointerDown={actions.onSavePointerDown}
        onMouseDown={(event) => event.preventDefault()}
        onClick={actions.save}
      />
    </div>
  )
}

export function EditorNavigation({
  file,
  tabs,
  actions,
  className = '',
  ...props
}: {
  file: ReactNode
  tabs: ComponentProps<typeof WorkspaceTabs>
  actions: EditorActions
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={`allsuite-editor-navigation ${className}`} role="toolbar">
      <div className="allsuite-editor-file">{file}</div>
      {/* Keep history before tabs in keyboard order, as in Grid's mobile workflow. */}
      <EditorActionCluster actions={actions} />
      <WorkspaceTabs {...tabs} />
    </div>
  )
}

/** Draft retains its File command panel until its separate ribbon redesign. */
export function EditorFileTrigger(props: ComponentProps<typeof Button>) {
  return (
    <Button {...props} className={`allsuite-editor-file-trigger ${props.className ?? ''}`} variant="outline" size="sm">
      {props.children}
      <svg
        aria-hidden="true"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
      >
        <path d="m8 10 4 4 4-4" />
      </svg>
    </Button>
  )
}
