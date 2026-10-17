import { metadata as draftMetadata } from '@allsuite/draft/metadata'
import type { AppMetadata, AppModule } from '../types/app'

export const APPS_METADATA: AppMetadata[] = [draftMetadata]

const loaders: Record<string, (() => Promise<AppModule>) | undefined> = {
  draft: () => import('@allsuite/draft'),
}

export async function loadAppComponent(slug: string) {
  const loader = Object.hasOwn(loaders, slug) ? loaders[slug] : undefined
  if (!loader) return null
  const module = await loader()
  return module.AppComponent
}
