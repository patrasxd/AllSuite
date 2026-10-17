import { safeGetItem } from '@all/ui'

const theme = safeGetItem('allsuite:theme') || 'dark'
if (['dark', 'light', 'e-ink-light', 'e-ink-dark'].includes(theme)) {
  document.documentElement.dataset.theme = theme
  document.documentElement.dataset.allTheme = theme
  if (theme.startsWith('e-ink')) document.documentElement.dataset.eink = 'true'
}
