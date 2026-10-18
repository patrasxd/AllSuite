import { useState, type FormEvent } from 'react'
import type { Editor } from '@tiptap/core'
import { Button, Heading, SidePanel, Text } from '@all/ui'
import type { CommentThread } from '../engine/comments'
import type { Locale } from '../types'
import { translations } from '../i18n'
import { getDraftButtonTooltip } from '../button-tooltips'
import { DraftIcon } from './DraftIcons'

function selectThread(editor: Editor, id: string) {
  let from: number | undefined
  let to: number | undefined
  editor.state.doc.descendants((node, position) => {
    if (!node.isText) return true
    if (!node.marks.some((mark) => mark.type.name === 'comment' && mark.attrs.id === id)) return true
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

export function CommentsPanel({
  editor,
  locale,
  threads,
  author,
  onAuthorChange,
  canComment,
  onAdd,
  onReply,
  onToggleResolved,
  onClose,
}: {
  editor: Editor
  locale: Locale
  threads: CommentThread[]
  author: string
  onAuthorChange: (value: string) => void
  canComment: boolean
  onAdd: (text: string) => void
  onReply: (id: string, text: string) => void
  onToggleResolved: (id: string) => void
  onClose: () => void
}) {
  const t = translations[locale]
  const [text, setText] = useState('')
  const [replies, setReplies] = useState<Record<string, string>>({})
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const value = text.trim()
    if (!value || !canComment) return
    onAdd(value)
    setText('')
  }
  return (
    <SidePanel
      className="draft-comments-panel"
      label={t.comments}
      title={<Heading level={2}>{t.comments}</Heading>}
      closeLabel={t.closeComments}
      onClose={onClose}
    >
      <form className="draft-comment-compose" onSubmit={submit}>
        <label htmlFor="draft-comment-author">{t.commentAuthor}</label>
        <input
          id="draft-comment-author"
          className="draft-comment-input"
          value={author}
          onChange={(event) => onAuthorChange(event.target.value)}
          maxLength={200}
          autoComplete="off"
        />
        <label htmlFor="draft-comment-text">{t.newComment}</label>
        <textarea
          id="draft-comment-text"
          className="draft-comment-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={3}
          maxLength={20_000}
          placeholder={t.selectTextForComment}
        />
        <Button
          type="submit"
          size="sm"
          variant="primary"
          icon={<DraftIcon name="comments" />}
          disabled={!canComment || !text.trim()}
        >
          {t.addComment}
        </Button>
        {!canComment && (
          <Text as="p" variant="caption">
            {t.selectTextForComment}
          </Text>
        )}
      </form>
      <div className="draft-comment-list" aria-live="polite">
        {threads.length === 0 ? (
          <Text as="p" variant="body">
            {t.noComments}
          </Text>
        ) : (
          threads.map((thread) => (
            <article className={`draft-comment-thread${thread.resolved ? ' is-resolved' : ''}`} key={thread.id}>
              <button
                type="button"
                className="draft-comment-anchor-link"
                title={getDraftButtonTooltip(locale, t.goToComment)}
                onClick={() => selectThread(editor, thread.id)}
              >
                <span className="draft-comment-author">{thread.author}</span>
                {thread.resolved && <span className="draft-comment-resolved">{t.resolved}</span>}
                <span className="draft-comment-body">{thread.text}</span>
              </button>
              {thread.replies.map((reply) => (
                <div className="draft-comment-reply" key={reply.id}>
                  <span className="draft-comment-author">{reply.author}</span>
                  <span>{reply.text}</span>
                </div>
              ))}
              <form
                className="draft-comment-reply-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  const value = (replies[thread.id] || '').trim()
                  if (!value) return
                  onReply(thread.id, value)
                  setReplies((current) => ({ ...current, [thread.id]: '' }))
                }}
              >
                <textarea
                  className="draft-comment-input"
                  aria-label={`${t.replyTo} ${thread.author}`}
                  value={replies[thread.id] || ''}
                  onChange={(event) => setReplies((current) => ({ ...current, [thread.id]: event.target.value }))}
                  rows={2}
                  maxLength={20_000}
                />
                <div className="draft-comment-actions">
                  <Button type="submit" size="sm" variant="outline" disabled={!(replies[thread.id] || '').trim()}>
                    {t.reply}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => onToggleResolved(thread.id)}>
                    {thread.resolved ? t.reopenComment : t.resolveComment}
                  </Button>
                </div>
              </form>
            </article>
          ))
        )}
      </div>
    </SidePanel>
  )
}
