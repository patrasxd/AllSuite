import { readFile, writeFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
const file = new URL('license-graph.json', import.meta.url)
const graph = JSON.parse(await readFile(file, 'utf8'))
const names = new Set([
  'jstat',
  'buffers',
  'chainsaw',
  'pako',
  'big-integer',
  'caniuse-lite',
  '@tanstack/virtual-core',
  'react',
  'react-dom',
  'scheduler',
  'loose-envify',
  'js-tokens',
])
for (const pkg of graph.packages.filter((p) => names.has(p.name))) {
  const response = await fetch(pkg.tarball)
  if (!response.ok) throw new Error(`${pkg.name}: ${response.status}`)
  const tar = gunzipSync(Buffer.from(await response.arrayBuffer()))
  const licenses = []
  for (let at = 0; at + 512 <= tar.length;) {
    const path = tar
      .subarray(at, at + 100)
      .toString()
      .replace(/\0.*$/s, '')
    if (!path) break
    const size =
      parseInt(
        tar
          .subarray(at + 124, at + 136)
          .toString()
          .replace(/\0.*$/s, '')
          .trim(),
        8,
      ) || 0
    const text = tar.subarray(at + 512, at + 512 + size).toString()
    if (/(?:^|\/)licen[cs]e(?:[-.]|$)/i.test(path))
      licenses.push({ path, sha256: createHash('sha256').update(text).digest('hex'), text })
    at += 512 + Math.ceil(size / 512) * 512
  }
  pkg.checkedLicenseFiles = licenses
  console.log(`${pkg.name}@${pkg.version}: ${licenses.map((x) => x.path).join(', ') || 'NO LICENSE FILE'}`)
}
await writeFile(file, JSON.stringify(graph, null, 2) + '\n')
