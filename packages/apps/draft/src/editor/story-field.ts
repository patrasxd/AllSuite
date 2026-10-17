import { Node } from '@tiptap/core'

export const StoryField = Node.create({
  name: 'storyField',
  inline: true,
  group: 'inline',
  atom: true,
  addAttributes: () => ({ field: { default: 'PAGE' } }),
  parseHTML: () => [
    { tag: 'span[data-story-field]', getAttrs: (element) => ({ field: element.getAttribute('data-story-field') }) },
  ],
  renderHTML: ({ node }) => [
    'span',
    { 'data-story-field': node.attrs.field, contenteditable: 'false', class: 'draft-story-field' },
    `{${node.attrs.field}}`,
  ],
})
