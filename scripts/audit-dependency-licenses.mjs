import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const allowed = new Set(['MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'ISC', 'OFL-1.1', '0BSD', 'Zlib'])
const chosenDualLicense = new Map([
  ['dompurify', 'Apache-2.0'],
  ['formualizer', 'MIT'],
  ['jszip', 'MIT'],
  ['type-fest', 'MIT'],
])
const firstParty = new Set(['@all/ui', '@allsuite/draft', '@allsuite/grid', '@allsuite/shell'])
const workspaceDirectories = ['apps/shell', 'packages/apps/draft', 'packages/apps/grid', 'AllUI']

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'))
}

async function packageAt(directory) {
  const manifest = await readJson(path.join(directory, 'package.json'))
  return { directory: path.resolve(directory), manifest }
}

async function resolvePackage(name, fromDirectory) {
  let current = fromDirectory
  while (true) {
    const candidate = path.join(current, 'node_modules', name)
    try {
      return await packageAt(candidate)
    } catch {
      const parent = path.dirname(current)
      if (parent === current) throw new Error(`Cannot resolve installed package ${name} from ${fromDirectory}`)
      current = parent
    }
  }
}

function licenseValue(manifest) {
  if (typeof manifest.license === 'string') return manifest.license
  if (Array.isArray(manifest.licenses)) return manifest.licenses.map((item) => item.type || item).join(' OR ')
  return 'UNKNOWN'
}

function assessment(name, license) {
  const chosen = chosenDualLicense.get(name)
  if (chosen) return { compliant: allowed.has(chosen), selectedLicense: chosen }
  return { compliant: allowed.has(license), selectedLicense: allowed.has(license) ? license : undefined }
}

const shipped = new Map()

async function visitShipped(name, fromDirectory) {
  const resolved = await resolvePackage(name, fromDirectory)
  const key = `${resolved.manifest.name}@${resolved.manifest.version}`
  if (shipped.has(key)) return
  shipped.set(key, resolved)
  const dependencies = { ...resolved.manifest.dependencies, ...resolved.manifest.optionalDependencies }
  for (const dependency of Object.keys(dependencies)) {
    try {
      await visitShipped(dependency, resolved.directory)
    } catch (error) {
      if (!resolved.manifest.optionalDependencies?.[dependency]) throw error
    }
  }
}

for (const workspaceDirectory of workspaceDirectories) {
  const workspace = await packageAt(path.join(root, workspaceDirectory))
  for (const dependency of Object.keys(workspace.manifest.dependencies || {}))
    await visitShipped(dependency, workspace.directory)
  for (const dependency of Object.keys(workspace.manifest.peerDependencies || {}))
    await visitShipped(dependency, workspace.directory)
}
const rootManifest = await readJson(path.join(root, 'package.json'))
for (const dependency of Object.keys(rootManifest.dependencies || {})) await visitShipped(dependency, root)

const installed = new Map()

async function scanNodeModules(directory) {
  let entries
  try {
    entries = await fs.readdir(directory, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    if (entry.name.startsWith('@')) {
      await scanNodeModules(path.join(directory, entry.name))
      continue
    }
    const packageDirectory = path.join(directory, entry.name)
    try {
      const resolved = await packageAt(packageDirectory)
      const key = `${resolved.manifest.name}@${resolved.manifest.version}`
      installed.set(key, resolved.manifest)
      await scanNodeModules(path.join(packageDirectory, 'node_modules'))
    } catch {
      // Ignore non-package directories inside node_modules.
    }
  }
}

for (const directory of [root, ...workspaceDirectories.map((item) => path.join(root, item))])
  await scanNodeModules(path.join(directory, 'node_modules'))

const packages = [...installed]
  .map(([key, manifest]) => {
    const license = licenseValue(manifest)
    return {
      name: manifest.name,
      version: manifest.version,
      license,
      scope: shipped.has(key) ? 'shipped' : 'development-only',
      ...assessment(manifest.name, license),
    }
  })
  .filter((item) => !firstParty.has(item.name))
  .sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version))

const summary = {
  generatedAt: new Date().toISOString(),
  installedPackages: packages.length,
  shippedPackages: packages.filter((item) => item.scope === 'shipped').length,
  shippedViolations: packages.filter((item) => item.scope === 'shipped' && !item.compliant).length,
  developmentOnlyOutsideProductAllowlist: packages.filter(
    (item) => item.scope === 'development-only' && !item.compliant,
  ).length,
}

await fs.mkdir(path.join(root, 'docs'), { recursive: true })
await fs.writeFile(
  path.join(root, 'docs', 'dependency-license-audit.json'),
  `${JSON.stringify({ allowlist: [...allowed], summary, packages }, null, 2)}\n`,
)

console.log(JSON.stringify(summary, null, 2))
if (summary.shippedViolations) {
  for (const item of packages.filter((entry) => entry.scope === 'shipped' && !entry.compliant))
    console.error(`${item.name}@${item.version}: ${item.license}`)
  process.exitCode = 1
}
