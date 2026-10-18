// Research only: downloads never enter the app graph. No package install or lifecycle scripts.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const root = new URL('./', import.meta.url)
const scratch = new URL('../../../../tmp/grid-review/', import.meta.url)
await mkdir(scratch, { recursive: true })
const names = [
  '@glideapps/glide-data-grid',
  '@tanstack/react-virtual',
  '@univerjs/preset-sheets-core',
  'exceljs',
  'xlsx',
  'formualizer',
  'fast-formula-parser',
  '@formulajs/formulajs',
  'hyperformula',
  'fflate',
  '@xmldom/xmldom',
]
const evidence = []
async function get(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${response.status}: ${url}`)
  return response
}
// Tar reader sufficient for registry ustar files; no extraction of arbitrary paths.
function entries(bytes) {
  const tar = gunzipSync(bytes)
  const files = new Map()
  for (let at = 0; at + 512 <= tar.length;) {
    const name = tar
      .subarray(at, at + 100)
      .toString()
      .replace(/\0.*$/s, '')
    if (!name) break
    const size =
      parseInt(
        tar
          .subarray(at + 124, at + 136)
          .toString()
          .replace(/\0.*$/s, '')
          .trim(),
        8,
      ) || 0
    files.set(name, tar.subarray(at + 512, at + 512 + size))
    at += 512 + Math.ceil(size / 512) * 512
  }
  return files
}
for (const name of names) {
  const metadata = await (await get(`https://registry.npmjs.org/${encodeURIComponent(name)}`)).json()
  const version = metadata['dist-tags'].latest
  const manifest = metadata.versions[version]
  const bytes = Buffer.from(await (await get(manifest.dist.tarball)).arrayBuffer())
  if (manifest.dist.integrity?.startsWith('sha512-'))
    assert.equal(`sha512-${createHash('sha512').update(bytes).digest('base64')}`, manifest.dist.integrity)
  const files = entries(bytes)
  const licenses = [...files]
    .filter(([path]) => /(?:^|\/)licen[cs]e(?:[-.]|$)/i.test(path))
    .map(([path, content]) => ({
      path,
      sha256: createHash('sha256').update(content).digest('hex'),
      excerpt: content.toString().slice(0, 220),
    }))
  const record = {
    name,
    version,
    published: metadata.time[version],
    license: manifest.license,
    dependencies: manifest.dependencies || {},
    peers: manifest.peerDependencies || {},
    unpackedBytes: manifest.dist.unpackedSize,
    tarball: manifest.dist.tarball,
    integrity: manifest.dist.integrity,
    licenseFiles: licenses,
  }
  evidence.push(record)
  // Exact license texts retained as review evidence for direct candidates, not redistributed runtime.
  await writeFile(
    new URL(`${name.replaceAll('/', '_').replace('@', '')}-licenses.txt`, scratch),
    [...files]
      .filter(([path]) => /(?:^|\/)licen[cs]e(?:[-.]|$)/i.test(path))
      .map(([path, content]) => `${path}\n${content}`)
      .join('\n'),
  )
  if (name === 'exceljs') {
    const bundle = files.get('package/dist/exceljs.min.js')
    await writeFile(new URL('exceljs.cjs', scratch), bundle)
    record.browserBundle = { bytes: bundle.length, gzipBytes: gzipSync(bundle).length }
  }
  console.log(`${name}@${version}: ${manifest.license}; ${licenses.length} license files`)
}
const sheetUrl = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs'
try {
  const bytes = Buffer.from(await (await get(sheetUrl)).arrayBuffer())
  await writeFile(new URL('sheetjs.mjs', scratch), bytes)
  const licenseText = await (await get('https://cdn.sheetjs.com/xlsx-0.20.3/package/LICENSE')).text()
  evidence.push({
    name: 'SheetJS official CE',
    version: '0.20.3',
    url: sheetUrl,
    bytes: bytes.length,
    gzipBytes: gzipSync(bytes).length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    licenseText,
  })
} catch (error) {
  evidence.push({ name: 'SheetJS official CE', version: '0.20.3', downloadError: String(error) })
}
const wasm = await readFile(
  new URL('../../../../node_modules/formualizer/pkg/formualizer_wasm_bg.wasm', import.meta.url),
)
await writeFile(
  new URL('candidate-evidence.json', root),
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      runtime: process.version,
      installedWasm: {
        bytes: wasm.length,
        gzipBytes: gzipSync(wasm).length,
        sha256: createHash('sha256').update(wasm).digest('hex'),
      },
      packages: evidence,
    },
    null,
    2,
  ) + '\n',
)
console.log(`Evidence: ${fileURLToPath(root)}`)
