import { Button, Dialog } from '@all/ui'
import type { Editor } from '@tiptap/core'
import type { Locale } from '../types'
import { translations } from '../i18n'

const symbols = ['©', '®', '™', '€', '£', '¥', '°', '±', '×', '÷', '≤', '≥', '≠', '≈', '∞', '§', '¶', '•', '…', '→']
const emoji = ['😀', '😊', '😂', '😍', '🤔', '👍', '👏', '🎉', '❤️', '✅', '⭐', '🔥', '🌍', '💡', '📌', '✍️']

interface Props {
  editor: Editor
  locale: Locale
  open: boolean
  initialTab: 'symbols' | 'emoji'
  onClose: () => void
}

export function SymbolDialog({ editor, locale, open, initialTab, onClose }: Props) {
  const t = translations[locale]
  const values = initialTab === 'emoji' ? emoji : symbols
  return (
    <Dialog open={open} onClose={onClose} title={initialTab === 'emoji' ? t.emoji : t.specialCharacters}>
      <div
        className="draft-symbol-grid"
        role="list"
        aria-label={initialTab === 'emoji' ? t.emoji : t.specialCharacters}
      >
        {values.map((value) => (
          <Button
            key={value}
            variant="secondary"
            aria-label={`${t.insertSymbol} ${value}`}
            onClick={() => {
              editor.chain().focus().insertContent(value).run()
              onClose()
            }}
          >
            {value}
          </Button>
        ))}
      </div>
    </Dialog>
  )
}
