import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import {
  AppHeader,
  HeaderMenu,
  ConfirmDialog,
  LegalNotice,
  useTheme,
  usePWAInstall,
  safeGetItem,
  safeSetItem,
} from '@all/ui'
import { HomePage } from './HomePage'
import type { Locale } from './types/app'
import { APPS_METADATA, loadAppComponent } from './apps/registry'

const appComponents = Object.fromEntries(
  APPS_METADATA.map(({ slug }) => [
    slug,
    lazy(async () => {
      const component = await loadAppComponent(slug)
      if (!component) throw new Error(`App is not registered: ${slug}`)
      return { default: component }
    }),
  ]),
)
const copy = {
  en: {
    back: 'Back to AllSuite',
  },
  pl: {
    back: 'Wróć do AllSuite',
  },
}

export default function App() {
  const [locale, setLocale] = useState<Locale>(() => (safeGetItem('allsuite:locale') === 'pl' ? 'pl' : 'en'))
  const [route, setRoute] = useState(window.location.hash)
  const [editorDirty, setEditorDirty] = useState(false)
  const [headerContent, setHeaderContent] = useState<ReactNode>(null)
  const [pendingRoute, setPendingRoute] = useState<string | null>(null)
  const { theme, setTheme, isEink, isDark } = useTheme()
  const { canInstall, install } = usePWAInstall()
  const t = copy[locale]
  const appMetadata = APPS_METADATA.find((app) => route === `#/${app.slug}`)
  const ActiveApp = appMetadata ? appComponents[appMetadata.slug] : null
  const inEditor = Boolean(ActiveApp)
  useEffect(() => {
    const change = () => {
      const next = window.location.hash
      if (editorDirty && inEditor && next !== route) {
        window.history.replaceState(null, '', route)
        setPendingRoute(next)
      } else setRoute(next)
    }
    window.addEventListener('hashchange', change)
    return () => window.removeEventListener('hashchange', change)
  }, [editorDirty, route, inEditor])
  useEffect(() => {
    setHeaderContent(null)
    setEditorDirty(false)
  }, [route])
  useEffect(() => {
    if (!editorDirty) return
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [editorDirty])
  useEffect(() => {
    document.documentElement.lang = locale
    document.title = appMetadata ? `${appMetadata.name[locale]} · AllSuite` : 'AllSuite'
    safeSetItem('allsuite:locale', locale)
  }, [locale, appMetadata])
  return (
    <div className="suite-shell">
      <AppHeader
        logo={
          <button
            type="button"
            className="header-logo"
            aria-label={t.back}
            onClick={() => {
              window.location.hash = '/'
            }}
          >
            <span>AllSuite</span>
          </button>
        }
        title={appMetadata?.name[locale]}
        actions={inEditor ? headerContent : undefined}
        menu={
          <HeaderMenu
            locale={locale}
            onLocaleChange={(value) => {
              if (value === 'en' || value === 'pl') setLocale(value)
            }}
            theme={theme}
            onThemeChange={(value) => {
              if (['dark', 'light', 'e-ink-light', 'e-ink-dark'].includes(value)) setTheme(value as typeof theme)
            }}
            isEink={isEink}
            onEinkChange={(enabled) =>
              setTheme(enabled ? (isDark ? 'e-ink-dark' : 'e-ink-light') : isDark ? 'dark' : 'light')
            }
            canInstall={canInstall}
            onInstall={async () => {
              await install()
            }}
          />
        }
      />
      {ActiveApp && (
        <div className="suite-workspace">
          <Suspense fallback={null}>
            <ActiveApp
              key={appMetadata?.slug}
              locale={locale}
              isEink={isEink}
              setHeader={setHeaderContent}
              isDirty={editorDirty}
              setIsDirty={setEditorDirty}
            />
          </Suspense>
        </div>
      )}
      {!inEditor &&
        (route === '#/legal' ? (
          <main className="legal-page">
            <div className="container">
              <LegalNotice
                appName="AllSuite"
                locale={locale}
                customSections={[
                  {
                    title: locale === 'pl' ? 'Prywatność' : 'Privacy',
                    content:
                      locale === 'pl'
                        ? 'Dokumenty są przetwarzane w pamięci przeglądarki i zapisywane na dysku wyłącznie na Twoje żądanie. Bez przesyłania plików, kont i analityki.'
                        : 'Documents are processed in browser memory and saved to disk only at your request. No uploads, accounts or analytics.',
                  },
                  {
                    title: locale === 'pl' ? 'Zapis dokumentów' : 'Saving documents',
                    content:
                      locale === 'pl'
                        ? 'Niezapisana praca znika po zamknięciu karty. Użyj Zapisz lub eksportu, aby zachować plik. Preferencje języka i motywu mogą być przechowywane lokalnie.'
                        : 'Unsaved work is lost when the tab closes. Use Save or export to keep your file. Language and theme preferences may be stored locally.',
                  },
                ]}
              />
              <p>
                <a href="/AllSuite/third-party-licenses.txt">
                  {locale === 'pl' ? 'Licencje i informacje o autorach' : 'Licenses and copyright notices'}
                </a>
              </p>
            </div>
          </main>
        ) : (
          <HomePage locale={locale} />
        ))}
      <ConfirmDialog
        open={pendingRoute !== null}
        title={locale === 'pl' ? 'Niezapisane zmiany' : 'Unsaved changes'}
        description={
          locale === 'pl'
            ? 'Zapisz dokument przed wyjściem z edytora.'
            : 'Save your document before leaving the editor.'
        }
        confirmLabel={locale === 'pl' ? 'Wyjdź bez zapisu' : 'Leave without saving'}
        cancelLabel={locale === 'pl' ? 'Zostań' : 'Stay'}
        confirmVariant="danger"
        onClose={() => setPendingRoute(null)}
        onConfirm={() => {
          const next = pendingRoute || '#/'
          setEditorDirty(false)
          setRoute(next)
          window.history.replaceState(null, '', next)
          setPendingRoute(null)
        }}
      />
    </div>
  )
}
