import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppFooter, CatalogCard, CatalogGrid, CatalogSectionHeader, DirectoryHero, FilterGroup } from '@all/ui'
import { APPS_METADATA } from './apps/registry'
import type { Locale } from './types/app'

export function HomePage({ locale }: { locale: Locale }) {
  const navigate = useNavigate()
  const [tag, setTag] = useState<string | null>(null)
  const pl = locale === 'pl'
  const tags = [...new Set(APPS_METADATA.flatMap((app) => app.tags[locale]))]
  const visibleApps = APPS_METADATA.filter((app) => tag === null || app.tags[locale].includes(tag))
  return (
    <main className="home-page">
      <div className="container">
        <DirectoryHero
          title={
            <>
              All
              <br />
              Suite
            </>
          }
          eyebrow={pl ? 'NARZĘDZIA BIUROWE W PRZEGLĄDARCE' : 'BROWSER OFFICE TOOLS'}
          description={
            pl
              ? 'Dokumenty i codzienna praca biurowa. Bez rejestracji, bez reklam. Twoje pliki zostają na Twoim urządzeniu.'
              : 'Documents and everyday office work. No registration, no ads. Your files stay on your device.'
          }
        />
        <section aria-labelledby="suite-catalog-label">
          <CatalogSectionHeader
            label={`${APPS_METADATA.length} ${pl ? 'APLIKACJA' : 'APP'}`}
            labelId="suite-catalog-label"
            filters={
              <FilterGroup<string | null>
                label={pl ? 'Filtruj aplikacje' : 'Filter apps'}
                value={tag}
                onChange={(value) => setTag(value === tag ? null : value)}
                options={[
                  {
                    id: 'all',
                    value: null,
                    label: pl ? 'Wszystkie' : 'All',
                    count: APPS_METADATA.length,
                    buttonId: 'filter-all-btn',
                  },
                  ...tags.map((value) => ({
                    id: value,
                    value,
                    label: value,
                    count: APPS_METADATA.filter((app) => app.tags[locale].includes(value)).length,
                  })),
                ]}
              />
            }
          />
          <CatalogGrid>
            {visibleApps.map((app) => (
              <div role="listitem" key={app.slug}>
                <CatalogCard
                  id={`app-card-${app.slug}`}
                  title={app.name[locale]}
                  description={app.description[locale]}
                  icon={app.icon}
                  tags={app.tags[locale]}
                  tagsLabel={pl ? 'Kategorie' : 'Categories'}
                  actionLabel={pl ? 'Otwórz' : 'Open'}
                  ariaLabel={`${pl ? 'Otwórz' : 'Open'} ${app.name[locale]}`}
                  clampDescription
                  onActivate={() => {
                    navigate(`/apps/${app.slug}`)
                  }}
                />
              </div>
            ))}
          </CatalogGrid>
        </section>
        <AppFooter
          legalLabel={pl ? 'Nota prawna & Prywatność' : 'Legal Notice & Privacy'}
          onLegalClick={() => {
            navigate('/legal')
          }}
          copyright="AllSuite © 2026. Free & Open Source."
          links={[
            { label: 'AllTools', href: 'https://patrasxd.github.io/AllTools/', external: true },
            { label: 'AllGames', href: 'https://patrasxd.github.io/AllGames/', external: true },
            { label: 'AllLinks', href: 'https://patrasxd.github.io/AllLinks/', external: true },
            { label: 'GitHub', href: 'https://github.com/patrasxd', external: true },
            { label: 'LinkedIn', href: 'https://www.linkedin.com/in/patryk-popio%C5%82ek-615048201/', external: true },
          ]}
        />
      </div>
    </main>
  )
}
