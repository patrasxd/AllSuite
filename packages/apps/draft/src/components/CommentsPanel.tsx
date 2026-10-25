import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { Editor } from '@tiptap/core'
import { Badge, Button, Card, Input, Stack, Text, TextArea } from '@all/ui'
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
  composeRequest,
  onStart,
  onAdd,
  onReply,
  onToggleResolved,
}: {
  editor: Editor
  locale: Locale
  threads: CommentThread[]
  author: string
  onAuthorChange: (value: string) => void
  canComment: boolean
  composeRequest: number
  onStart: () => void
  onAdd: (text: string) => void
  onReply: (id: string, text: string) => void
  onToggleResolved: (id: string) => void
}) {
  const t = translations[locale]
  const [text, setText] = useState('')
  const [composing, setComposing] = useState(false)
  const [replying, setReplying] = useState<Record<string, boolean>>({})
  const [replies, setReplies] = useState<Record<string, string>>({})
  const composer = useRef<HTMLTextAreaElement>(null)
  const focusReply = useCallback((element: HTMLTextAreaElement | null) => element?.focus(), [])
  useEffect(() => {
    if (composeRequest) setComposing(true)
  }, [composeRequest])
  useEffect(() => {
    if (composing) composer.current?.focus()
  }, [composing, composeRequest])
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const value = text.trim()
    if (!value || !canComment) return
    onAdd(value)
    setText('')
    setComposing(false)
  }
  return (
    <div className="draft-comments-content">
      <Stack gap="sm" className="draft-pane-intro">
        <Button
          size="sm"
          variant="outline"
          icon={<DraftIcon name="comments" />}
          disabled={!canComment && !text}
          aria-expanded={composing}
          aria-controls="draft-comment-compose"
          onClick={() => {
            if (!composing) onStart()
            setComposing((value) => !value)
          }}
        >
          {t.newComment}
        </Button>
        {!canComment && <Text variant="caption">{t.selectTextForComment}</Text>}
      </Stack>
      {composing && (
        <form id="draft-comment-compose" className="draft-comment-compose" onSubmit={submit}>
          <TextArea
            ref={composer}
            label={t.newComment}
            fullWidth
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
        </form>
      )}
      <div className="draft-comment-list" aria-live="polite">
        {threads.length === 0 ? (
          <Text as="p" variant="body">
            {t.noComments}
          </Text>
        ) : (
          threads.map((thread) => (
            <Card
              role="article"
              variant="outlined"
              padding="sm"
              className={`draft-comment-thread${thread.resolved ? ' is-resolved' : ''}`}
              key={thread.id}
            >
              <Button
                type="button"
                variant="ghost"
                className="draft-comment-anchor-link"
                tooltip={getDraftButtonTooltip(locale, t.goToComment)}
                onClick={() => selectThread(editor, thread.id)}
              >
                <span className="draft-comment-byline">
                  <Text as="span" className="draft-comment-author">
                    {thread.author}
                  </Text>
                  {thread.resolved && <Badge size="sm">{t.resolved}</Badge>}
                </span>
                <Text as="span" className="draft-comment-body">
                  {thread.text}
                </Text>
              </Button>
              {thread.replies.map((reply) => (
                <div className="draft-comment-reply" key={reply.id}>
                  <Text as="span" className="draft-comment-author">
                    {reply.author}
                  </Text>
                  <Text as="span" className="draft-comment-body">
                    {reply.text}
                  </Text>
                </div>
              ))}
              <Stack direction="row" gap="sm" wrap>
                <Button
                  size="sm"
                  variant="outline"
                  aria-expanded={Boolean(replying[thread.id])}
                  onClick={() => setReplying((current) => ({ ...current, [thread.id]: !current[thread.id] }))}
                >
                  {t.reply}
                </Button>
                <Button size="sm" variant="outline" onClick={() => onToggleResolved(thread.id)}>
                  {thread.resolved ? t.reopenComment : t.resolveComment}
                </Button>
              </Stack>
              {replying[thread.id] && (
                <form
                  className="draft-comment-reply-form"
                  onSubmit={(event) => {
                    event.preventDefault()
                    const value = (replies[thread.id] || '').trim()
                    if (!value) return
                    onReply(thread.id, value)
                    setReplies((current) => ({ ...current, [thread.id]: '' }))
                    setReplying((current) => ({ ...current, [thread.id]: false }))
                  }}
                >
                  <TextArea
                    ref={focusReply}
                    fullWidth
                    aria-label={`${t.replyTo} ${thread.author}`}
                    value={replies[thread.id] || ''}
                    onChange={(event) => setReplies((current) => ({ ...current, [thread.id]: event.target.value }))}
                    rows={2}
                    maxLength={20_000}
                  />
                  <div className="draft-comment-actions">
                    <Button type="submit" size="sm" variant="primary" disabled={!(replies[thread.id] || '').trim()}>
                      {t.reply}
                    </Button>
                  </div>
                </form>
              )}
            </Card>
          ))
        )}
      </div>
      <details className="draft-pane-settings">
        <summary>{t.commentAuthor}</summary>
        <Input
          label={t.commentAuthor}
          fullWidth
          value={author}
          onChange={(event) => onAuthorChange(event.target.value)}
          maxLength={200}
          autoComplete="off"
        />
      </details>
    </div>
  )
}
