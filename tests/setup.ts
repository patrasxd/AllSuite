import '@testing-library/jest-dom'

// JSDOM has no layout engine; real commands use these browser geometry methods on focus.
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
}
if (!document.elementFromPoint) document.elementFromPoint = () => null
