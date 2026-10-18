// Candidate dependency investigation only; resolves runtime/required peers without installing code.
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
const { maxSatisfying } = createRequire(import.meta.url)('semver')
const evidence = JSON.parse(await readFile(new URL('candidate-evidence.json', import.meta.url), 'utf8'))
const metadataCache = new Map()
const graph = new Map()
async function metadata(name) {
  if (!metadataCache.has(name))
    metadataCache.set(
      name,
      fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`).then(async (r) => {
        if (!r.ok) throw new Error(`${name}: ${r.status}`)
        return r.json()
      }),
    )
  return metadataCache.get(name)
}
async function visit(name, range, ancestry = new Set()) {
  const all = await metadata(name)
  // Fix shared React to the workspace's 18.x family; this is candidate resolution, not a lockfile.
  const chosenRange = ['react', 'react-dom'].includes(name) ? '18.3.1' : range
  const version = maxSatisfying(Object.keys(all.versions), chosenRange)
  if (!version) throw new Error(`Unresolved ${name}@${range}`)
  const key = `${name}@${version}`
  if (ancestry.has(key)) return key
  if (!graph.has(key)) {
    const p = all.versions[version]
    graph.set(key, {
      name,
      version,
      license: p.license || 'UNKNOWN',
      tarball: p.dist.tarball,
      dependencies: [],
      optionalNotEvaluated: p.optionalDependencies || {},
    })
    const next = new Set([...ancestry, key])
    const deps = { ...p.dependencies }
    for (const [peer, requirement] of Object.entries(p.peerDependencies || {})) {
      if (!p.peerDependenciesMeta?.[peer]?.optional) deps[peer] ??= requirement
    }
    // Sequential recursion avoids a race returning an unfinished graph.
    for (const [dep, requirement] of Object.entries(deps)) {
      graph.get(key).dependencies.push(await visit(dep, requirement, next))
    }
  }
  return key
}
const candidates = []
for (const p of evidence.packages.filter((p) => p.dependencies && p.name !== 'hyperformula')) {
  const key = await visit(p.name, p.version)
  const closure = new Set()
  function collect(id) {
    if (closure.has(id)) return
    closure.add(id)
    for (const dep of graph.get(id).dependencies) collect(dep)
  }
  collect(key)
  candidates.push({ key, closure: [...closure].sort() })
  console.log(`${key}: ${closure.size} runtime/required-peer packages`)
}
const packages = [...graph.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
await writeFile(
  new URL('license-graph.json', import.meta.url),
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      method:
        'Registry manifest declarations only; independent resolution per dependency edge, React pinned to 18.3.1; optional peer packages omitted. Not a bundler graph, installed lockfile, license-text audit or WASM/Rust closure approval.',
      candidates,
      packages,
    },
    null,
    2,
  ) + '\n',
)
console.log([...new Set(packages.map((p) => p.license))])
