# Third-party licenses

## MVP 3 release review (2026-10-16)

No dependencies or versions were added for this release gate. The installed-tree audit reports 718 installed packages, 115 shipped packages and zero shipped license violations. Eighteen development-only packages fall outside the product allowlist; they are not product runtime dependencies. Detailed audit reports are generated locally and uploaded as CI artifacts.

Offline direct PDF now precaches the already-distributed local WOFF fonts as well as WOFF2. Both formats are covered by the existing OFL family licenses and notices; no proprietary or remote fonts were added. The production `third-party-licenses.txt` retains the editor/PDF and font notices. PDF.js/native canvas remain development-only verification tools. The AllUI revision and its pre-existing local changes were preserved. Detailed release evidence is uploaded as CI artifacts.

## Shell and shared runtime

| name                                                                                          | version | license | where used                       |
| --------------------------------------------------------------------------------------------- | ------- | ------- | -------------------------------- |
| [@fontsource/inter](https://registry.npmjs.org/%40fontsource%2Finter/5.3.0)                   | 5.3.0   | OFL-1.1 | Shell interface font assets      |
| [@fontsource/jetbrains-mono](https://registry.npmjs.org/%40fontsource%2Fjetbrains-mono/5.3.0) | 5.3.0   | OFL-1.1 | Shell interface monospace assets |
| [framer-motion](https://registry.npmjs.org/framer-motion/11.18.2)                             | 11.18.2 | MIT     | Shared UI motion                 |
| [js-tokens](https://registry.npmjs.org/js-tokens/4.0.0)                                       | 4.0.0   | MIT     | React runtime dependency         |
| [loose-envify](https://registry.npmjs.org/loose-envify/1.4.0)                                 | 1.4.0   | MIT     | React runtime dependency         |
| [motion-dom](https://registry.npmjs.org/motion-dom/11.18.1)                                   | 11.18.1 | MIT     | Shared UI motion dependency      |
| [motion-utils](https://registry.npmjs.org/motion-utils/11.18.1)                               | 11.18.1 | MIT     | Shared UI motion dependency      |
| [react](https://registry.npmjs.org/react/18.3.1)                                              | 18.3.1  | MIT     | Shell and Draft runtime          |
| [react-dom](https://registry.npmjs.org/react-dom/18.3.1)                                      | 18.3.1  | MIT     | Shell and Draft runtime          |
| [react-router](https://registry.npmjs.org/react-router/7.18.4)                                | 7.18.4  | MIT     | Shell browser-history routing    |
| [react-router-dom](https://registry.npmjs.org/react-router-dom/7.18.4)                        | 7.18.4  | MIT     | Shell browser-history routing    |
| [cookie](https://registry.npmjs.org/cookie/1.1.1)                                             | 1.1.1   | MIT     | React Router runtime dependency  |
| [set-cookie-parser](https://registry.npmjs.org/set-cookie-parser/2.7.2)                       | 2.7.2   | MIT     | React Router runtime dependency  |
| [scheduler](https://registry.npmjs.org/scheduler/0.23.2)                                      | 0.23.2  | MIT     | React runtime dependency         |
| [tslib](https://registry.npmjs.org/tslib/2.8.1)                                               | 2.8.1   | 0BSD    | Shared runtime helpers           |

The complete installed dependency graph is checked by `npm run license:check`. Its machine-readable report is generated locally and uploaded as a CI artifact. The MVP 2 release audit on 2026-10-15 checked 700 installed packages and 99 shipped runtime packages, with zero shipped allowlist violations. The report also retains 18 development-only tools and browser compatibility data packages whose licenses fall outside the product redistribution allowlist; these packages are not bundled or shipped with AllSuite. No dependencies were added for the MVP 2 release gate.

Tables use the MIT `@tiptap/extension-table` exports below. Images, styles, references and exports reuse the listed editor/DOCX/XML/ZIP packages; the chart renderer is original AllSuite code. PDF uses native browser printing, with no additional PDF runtime. Document fonts use the listed OFL-1.1 assets, including Latin Extended subsets. Exact installed package manifests and license files were compared with this inventory and the generated audit. Runtime notices are kept in `licenses/editor-license-notices.txt` and `licenses/font-license-notices.txt`, combined into the production `third-party-licenses.txt` asset. The inventory does not grant rights to user-supplied document content or images.

The MVP 2 audit added supplementary MIT notices for hash.js 1.1.7 and isarray 1.0.0 from their exact installed README license sections. These distributions have no standalone LICENSE file. Versioned audit evidence and license-source hashes are retained in CI artifacts rather than the repository.

## Draft runtime

| name                                                                                                         | version | license                                 | where used                                   |
| ------------------------------------------------------------------------------------------------------------ | ------- | --------------------------------------- | -------------------------------------------- |
| [@fontsource/arimo](https://registry.npmjs.org/%40fontsource%2Farimo/5.3.0)                                  | 5.3.0   | OFL-1.1                                 | Draft document font assets                   |
| [katex](https://registry.npmjs.org/katex/0.19.0)                                                             | 0.19.0  | MIT                                     | Draft equation rendering / MathML conversion |
| [@fontsource/caladea](https://registry.npmjs.org/%40fontsource%2Fcaladea/5.3.0)                              | 5.3.0   | OFL-1.1                                 | Draft document font assets                   |
| [@fontsource/carlito](https://registry.npmjs.org/%40fontsource%2Fcarlito/5.3.0)                              | 5.3.0   | OFL-1.1                                 | Draft document font assets                   |
| [@fontsource/cousine](https://registry.npmjs.org/%40fontsource%2Fcousine/5.3.0)                              | 5.3.0   | OFL-1.1                                 | Draft document font assets                   |
| [@fontsource/tinos](https://registry.npmjs.org/%40fontsource%2Ftinos/5.3.0)                                  | 5.3.0   | OFL-1.1                                 | Draft document font assets                   |
| [@tiptap/core](https://registry.npmjs.org/%40tiptap%2Fcore/3.32.0)                                           | 3.32.0  | MIT                                     | Draft editor runtime / extension dependency  |
| [@tiptap/extension-blockquote](https://registry.npmjs.org/%40tiptap%2Fextension-blockquote/3.32.0)           | 3.32.0  | MIT                                     | Draft editor runtime / extension dependency  |
| [@tiptap/extension-bold](https://registry.npmjs.org/%40tiptap%2Fextension-bold/3.32.0)                       | 3.32.0  | MIT                                     | Draft editor runtime / extension dependency  |
| [@tiptap/extension-bubble-menu](https://registry.npmjs.org/%40tiptap%2Fextension-bubble-menu/3.32.0)         | 3.32.0  | MIT                                     | Draft editor runtime / extension dependency  |
| [@tiptap/extension-bullet-list](https://registry.npmjs.org/%40tiptap%2Fextension-bullet-list/3.32.0)         | 3.32.0  | MIT                                     | Draft editor runtime / extension dependency  |
| [@tiptap/extension-code](https://registry.npmjs.org/%40tiptap%2Fextension-code/3.32.0)                       | 3.32.0  | MIT                                     | Draft editor runtime / extension dependency  |
| [@tiptap/extension-code-block](https://registry.npmjs.org/%40tiptap%2Fextension-code-block/3.32.0)           | 3.32.0  | MIT                                     | Draft editor runtime / extension dependency  |
| [@tiptap/extension-document](https://registry.npmjs.org/%40tiptap%2Fextension-document/3.32.0)               | 3.32.0  | MIT                                     | Draft editor runtime / extension dependency  |
| [@tiptap/extension-dropcursor](https://registry.npmjs.org/%40tiptap%2Fextension-dropcursor/3.32.0)           | 3.32.0  | MIT                                     | Draft editor runtime / extension dependency  |
| [@tiptap/extension-floating-menu](https://registry.npmjs.org/%40tiptap%2Fextension-floating-menu/3.32.0)     | 3.32.0  | MIT                                     | Draft editor runtime / extension dependency  |
| [@tiptap/extension-gapcursor](https://registry.npmjs.org/%40tiptap%2Fextension-gapcursor/3.32.0)             | 3.32.0  | MIT                                     | Draft editor runtime / extension dependency  |
| [@tiptap/extension-hard-break](https://registry.npmjs.org/%40tiptap%2Fextension-hard-break/3.32.0)           | 3.32.0  | MIT                                     | Draft editor runtime / extension dependency  |
| [@tiptap/extension-heading](https://registry.npmjs.org/%40tiptap%2Fextension-heading/3.32.0)                 | 3.32.0  | MIT                                     | Draft editor runtime / extension dependency  |
| [@tiptap/extension-highlight](https://registry.npmjs.org/%40tiptap%2Fextension-highlight/3.32.0)             | 3.32.0  | MIT                                     | Draft editor runtime / extension dependency  |
| [@tiptap/extension-horizontal-rule](https://registry.npmjs.org/%40tiptap%2Fextension-horizontal-rule/3.32.0) | 3.32.0  | MIT                                     | Draft editor runtime / extension dependency  |
| [@tiptap/extension-italic](https://registry.npmjs.org/%40tiptap%2Fextension-italic/3.32.0)                   | 3.32.0  | MIT                                     | Draft editor runtime / extension dependency  |
| [@tiptap/extension-link](https://registry.npmjs.org/%40tiptap%2Fextension-link/3.32.0)                       | 3.32.0  | MIT                                     | Draft editor runtime / extension dependency  |
| [@tiptap/extension-list](https://registry.npmjs.org/%40tiptap%2Fextension-list/3.32.0)                       | 3.32.0  | MIT                                     | Draft editor runtime / extension dependency  |
| [@tiptap/extension-list-item](https://registry.npmjs.org/%40tiptap%2Fextension-list-item/3.32.0)             | 3.32.0  | MIT                                     | Draft editor runtime / extension dependency  |
| [@tiptap/extension-list-keymap](https://registry.npmjs.org/%40tiptap%2Fextension-list-keymap/3.32.0)         | 3.32.0  | MIT                                     | Draft editor runtime / extension dependency  |
| [@tiptap/extension-ordered-list](https://registry.npmjs.org/%40tiptap%2Fextension-ordered-list/3.32.0)       | 3.32.0  | MIT                                     | Draft editor runtime / extension dependency  |
| [@tiptap/extension-paragraph](https://registry.npmjs.org/%40tiptap%2Fextension-paragraph/3.32.0)             | 3.32.0  | MIT                                     | Draft editor runtime / extension dependency  |
| [@tiptap/extension-strike](https://registry.npmjs.org/%40tiptap%2Fextension-strike/3.32.0)                   | 3.32.0  | MIT                                     | Draft editor runtime / extension dependency  |
| [@tiptap/extension-subscript](https://registry.npmjs.org/%40tiptap%2Fextension-subscript/3.32.0)             | 3.32.0  | MIT                                     | Draft editor runtime / extension dependency  |
| [@tiptap/extension-superscript](https://registry.npmjs.org/%40tiptap%2Fextension-superscript/3.32.0)         | 3.32.0  | MIT                                     | Draft editor runtime / extension dependency  |
| [@tiptap/extension-text](https://registry.npmjs.org/%40tiptap%2Fextension-text/3.32.0)                       | 3.32.0  | MIT                                     | Draft editor runtime / extension dependency  |
| [@tiptap/extension-text-align](https://registry.npmjs.org/%40tiptap%2Fextension-text-align/3.32.0)           | 3.32.0  | MIT                                     | Draft editor runtime / extension dependency  |
| [@tiptap/extension-text-style](https://registry.npmjs.org/%40tiptap%2Fextension-text-style/3.32.0)           | 3.32.0  | MIT                                     | Draft editor runtime / extension dependency  |
| [@tiptap/extension-underline](https://registry.npmjs.org/%40tiptap%2Fextension-underline/3.32.0)             | 3.32.0  | MIT                                     | Draft editor runtime / extension dependency  |
| [@tiptap/extensions](https://registry.npmjs.org/%40tiptap%2Fextensions/3.32.0)                               | 3.32.0  | MIT                                     | Draft editor runtime / extension dependency  |
| [@tiptap/pm](https://registry.npmjs.org/%40tiptap%2Fpm/3.32.0)                                               | 3.32.0  | MIT                                     | Draft editor runtime / extension dependency  |
| [@tiptap/react](https://registry.npmjs.org/%40tiptap%2Freact/3.32.0)                                         | 3.32.0  | MIT                                     | Draft editor runtime / extension dependency  |
| [@tiptap/starter-kit](https://registry.npmjs.org/%40tiptap%2Fstarter-kit/3.32.0)                             | 3.32.0  | MIT                                     | Draft editor runtime / extension dependency  |
| [@xmldom/xmldom](https://registry.npmjs.org/%40xmldom%2Fxmldom/0.9.12)                                       | 0.9.12  | MIT                                     | Draft DOCX and Grid XLSX XML parsing         |
| [commander](https://registry.npmjs.org/commander/15.0.0)                                                     | 15.0.0  | MIT                                     | KaTeX command-line dependency                |
| [docx](https://registry.npmjs.org/docx/9.11.0)                                                               | 9.11.0  | MIT                                     | Draft DOCX exporter                          |
| [fflate](https://registry.npmjs.org/fflate/0.8.3)                                                            | 0.8.3   | MIT                                     | Draft DOCX and Grid XLSX ZIP reading         |
| [pako](https://registry.npmjs.org/pako/1.0.4)                                                                | 1.0.4   | MIT                                     | Pinned DOCX export transitive dependency     |
| [prismjs](https://registry.npmjs.org/prismjs/1.30.0)                                                         | 1.30.0  | MIT                                     | Draft lazy code syntax highlighting          |
| [sax](https://registry.npmjs.org/sax/1.2.4)                                                                  | 1.2.4   | ISC                                     | Pinned DOCX export transitive dependency     |
| [dompurify](https://registry.npmjs.org/dompurify/3.4.17)                                                     | 3.4.17  | Apache-2.0 (chosen dual-license option) | Draft rich-text clipboard sanitizer          |

Exact npm manifests were checked individually before installation. Linked version-specific manifests provide the license evidence. File I/O pins `pako` and `sax` to allowed-license versions used by docx transitively. Disabled/optional extensions are listed because they are distributed dependencies. See `licenses/editor-license-notices.txt` and `licenses/font-license-notices.txt` for installed package notices.

## Transitive editor dependencies

| name                                                                                                  | version | license | where used                          |
| ----------------------------------------------------------------------------------------------------- | ------- | ------- | ----------------------------------- |
| [@floating-ui/core](https://registry.npmjs.org/%40floating-ui%2Fcore/1.8.0)                           | 1.8.0   | MIT     | Draft runtime transitive dependency |
| [@floating-ui/dom](https://registry.npmjs.org/%40floating-ui%2Fdom/1.8.0)                             | 1.8.0   | MIT     | Draft runtime transitive dependency |
| [@floating-ui/utils](https://registry.npmjs.org/%40floating-ui%2Futils/0.2.12)                        | 0.2.12  | MIT     | Draft runtime transitive dependency |
| [@types/node](https://registry.npmjs.org/%40types%2Fnode/26.6.5)                                      | 26.6.5  | MIT     | Draft runtime transitive dependency |
| [@types/trusted-types](https://registry.npmjs.org/%40types%2Ftrusted-types/2.0.7)                     | 2.0.7   | MIT     | Draft runtime transitive dependency |
| [@types/use-sync-external-store](https://registry.npmjs.org/%40types%2Fuse-sync-external-store/0.0.6) | 0.0.6   | MIT     | Draft runtime transitive dependency |
| [core-util-is](https://registry.npmjs.org/core-util-is/1.0.3)                                         | 1.0.3   | MIT     | Draft runtime transitive dependency |
| [fast-equals](https://registry.npmjs.org/fast-equals/5.4.4)                                           | 5.4.4   | MIT     | Draft runtime transitive dependency |
| [hash.js](https://registry.npmjs.org/hash.js/1.1.7)                                                   | 1.1.7   | MIT     | Draft runtime transitive dependency |
| [immediate](https://registry.npmjs.org/immediate/3.0.6)                                               | 3.0.6   | MIT     | Draft runtime transitive dependency |
| [inherits](https://registry.npmjs.org/inherits/2.0.4)                                                 | 2.0.4   | ISC     | Draft runtime transitive dependency |
| [isarray](https://registry.npmjs.org/isarray/1.0.0)                                                   | 1.0.0   | MIT     | Draft runtime transitive dependency |
| [jszip](https://registry.npmjs.org/jszip/3.10.2)                                                      | 3.10.2  | MIT     | Draft runtime transitive dependency |
| [lie](https://registry.npmjs.org/lie/3.3.0)                                                           | 3.3.0   | MIT     | Draft runtime transitive dependency |
| [linkifyjs](https://registry.npmjs.org/linkifyjs/4.3.3)                                               | 4.3.3   | MIT     | Draft runtime transitive dependency |
| [minimalistic-assert](https://registry.npmjs.org/minimalistic-assert/1.0.1)                           | 1.0.1   | ISC     | Draft runtime transitive dependency |
| [nanoid](https://registry.npmjs.org/nanoid/6.0.2)                                                     | 6.0.2   | MIT     | Draft runtime transitive dependency |
| [orderedmap](https://registry.npmjs.org/orderedmap/2.1.1)                                             | 2.1.1   | MIT     | Draft runtime transitive dependency |
| [process-nextick-args](https://registry.npmjs.org/process-nextick-args/2.0.1)                         | 2.0.1   | MIT     | Draft runtime transitive dependency |
| [prosemirror-changeset](https://registry.npmjs.org/prosemirror-changeset/2.4.4)                       | 2.4.4   | MIT     | Draft runtime transitive dependency |
| [prosemirror-commands](https://registry.npmjs.org/prosemirror-commands/1.7.2)                         | 1.7.2   | MIT     | Draft runtime transitive dependency |
| [prosemirror-dropcursor](https://registry.npmjs.org/prosemirror-dropcursor/1.8.4)                     | 1.8.4   | MIT     | Draft runtime transitive dependency |
| [prosemirror-gapcursor](https://registry.npmjs.org/prosemirror-gapcursor/1.4.1)                       | 1.4.1   | MIT     | Draft runtime transitive dependency |
| [prosemirror-history](https://registry.npmjs.org/prosemirror-history/1.5.1)                           | 1.5.1   | MIT     | Draft runtime transitive dependency |
| [prosemirror-inputrules](https://registry.npmjs.org/prosemirror-inputrules/1.5.1)                     | 1.5.1   | MIT     | Draft runtime transitive dependency |
| [prosemirror-keymap](https://registry.npmjs.org/prosemirror-keymap/1.2.3)                             | 1.2.3   | MIT     | Draft runtime transitive dependency |
| [prosemirror-model](https://registry.npmjs.org/prosemirror-model/1.25.12)                             | 1.25.12 | MIT     | Draft runtime transitive dependency |
| [prosemirror-schema-list](https://registry.npmjs.org/prosemirror-schema-list/1.5.1)                   | 1.5.1   | MIT     | Draft runtime transitive dependency |
| [prosemirror-state](https://registry.npmjs.org/prosemirror-state/1.4.4)                               | 1.4.4   | MIT     | Draft runtime transitive dependency |
| [prosemirror-tables](https://registry.npmjs.org/prosemirror-tables/1.8.5)                             | 1.8.5   | MIT     | Draft runtime transitive dependency |
| [prosemirror-transform](https://registry.npmjs.org/prosemirror-transform/1.12.2)                      | 1.12.2  | MIT     | Draft runtime transitive dependency |
| [prosemirror-view](https://registry.npmjs.org/prosemirror-view/1.42.6)                                | 1.42.6  | MIT     | Draft runtime transitive dependency |
| [readable-stream](https://registry.npmjs.org/readable-stream/2.3.8)                                   | 2.3.8   | MIT     | Draft runtime transitive dependency |
| [rope-sequence](https://registry.npmjs.org/rope-sequence/1.3.4)                                       | 1.3.4   | MIT     | Draft runtime transitive dependency |
| [safe-buffer](https://registry.npmjs.org/safe-buffer/5.1.2)                                           | 5.1.2   | MIT     | Draft runtime transitive dependency |
| [setimmediate](https://registry.npmjs.org/setimmediate/1.0.5)                                         | 1.0.5   | MIT     | Draft runtime transitive dependency |
| [string_decoder](https://registry.npmjs.org/string_decoder/1.1.1)                                     | 1.1.1   | MIT     | Draft runtime transitive dependency |
| [undici-types](https://registry.npmjs.org/undici-types/8.9.0)                                         | 8.9.0   | MIT     | Draft runtime transitive dependency |
| [use-sync-external-store](https://registry.npmjs.org/use-sync-external-store/1.7.0)                   | 1.7.0   | MIT     | Draft runtime transitive dependency |
| [util-deprecate](https://registry.npmjs.org/util-deprecate/1.0.2)                                     | 1.0.2   | MIT     | Draft runtime transitive dependency |
| [w3c-keyname](https://registry.npmjs.org/w3c-keyname/2.2.8)                                           | 2.2.8   | MIT     | Draft runtime transitive dependency |
| [xml-js](https://registry.npmjs.org/xml-js/1.6.11)                                                    | 1.6.11  | MIT     | Draft runtime transitive dependency |
| [xml](https://registry.npmjs.org/xml/1.0.1)                                                           | 1.0.1   | MIT     | Draft runtime transitive dependency |

Table support: @tiptap/extension-table 3.32.0 (Table, TableRow, TableCell and TableHeader exports), MIT, Copyright (c) 2025 Tiptap GmbH. Verified exact-version upstream manifest and LICENSE.md at https://github.com/ueberdosis/tiptap/tree/v3.32.0/packages/extension-table . Only peer dependencies are the already audited @tiptap/core and @tiptap/pm 3.32.0; ProseMirror tables is already included by @tiptap/pm. MIT notice retained in `licenses/editor-license-notices.txt`.

## Grid runtime virtualization

The Grid renderer uses the headless DOM virtualizer selected in the Grid architecture decision. The exact installed package manifests and MIT license files were checked from the locked npm archives; React and React DOM are existing shell peers. These packages add no fonts, icons or other redistributed assets. Their notice is retained in `licenses/editor-license-notices.txt`, which is included in the production `third-party-licenses.txt` asset.

| name                                                                                                        | version | license | where used                                      |
| ----------------------------------------------------------------------------------------------------------- | ------- | ------- | ----------------------------------------------- |
| [@tanstack/react-virtual](https://registry.npmjs.org/%40tanstack/react-virtual/-/react-virtual-3.14.21.tgz) | 3.14.21 | MIT     | Grid lazy row and column windowing              |
| [@tanstack/virtual-core](https://registry.npmjs.org/%40tanstack/virtual-core/-/virtual-core-3.19.6.tgz)     | 3.19.6  | MIT     | Runtime dependency of `@tanstack/react-virtual` |

The React adapter accepts React 18 and React DOM 18 as peers. The exact resolved versions and integrity hashes are recorded in `package-lock.json`. The runtime closure contains only `@tanstack/virtual-core` beyond the adapter itself. Exact installed manifests and `LICENSE` files were inspected before inclusion.

## Print/PDF layout dependencies (2026-10-16)

Exact archives were inspected in `tmp/print-pdf/licenses` and the isolated `tmp/print-pdf/review` installation before adding product dependencies. All choices below are on rule 06's allowlist. Distributed notices are appended to `licenses/editor-license-notices.txt`; supplementary PDF audit notices are retained in CI artifacts.

| Package/version               | Verified license                 | Authoritative evidence                                                                        |
| ----------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------- |
| pdf-lib 1.17.1                | MIT                              | npm archive LICENSE.md; https://github.com/Hopding/pdf-lib/tree/v1.17.1                       |
| fontkit 2.0.4                 | MIT                              | exact archive package.json and README License; https://github.com/foliojs/fontkit/tree/v2.0.4 |
| @pdf-lib/standard-fonts 1.0.0 | MIT                              | exact archive LICENSE.md                                                                      |
| @pdf-lib/upng 1.0.1           | MIT                              | exact archive LICENSE                                                                         |
| @swc/helpers 0.5.23           | Apache-2.0                       | exact installed package LICENSE                                                               |
| base64-js 1.5.1               | MIT                              | exact installed package LICENSE                                                               |
| brotli 1.3.3                  | MIT; Apache-2.0 decoder portions | exact README/package.json; retained Google 2013 Apache headers in dec/*.js                    |
| clone 2.1.2                   | MIT                              | exact package LICENSE                                                                         |
| dfa 1.2.0                     | MIT                              | exact README License and package.json                                                         |
| fast-deep-equal 3.1.3         | MIT                              | exact package LICENSE                                                                         |
| restructure 3.0.2             | MIT                              | exact package LICENSE                                                                         |
| tiny-inflate 1.0.3            | MIT                              | exact package LICENSE                                                                         |
| unicode-properties 1.4.1      | MIT                              | exact package LICENSE                                                                         |
| unicode-trie 2.0.0            | MIT                              | exact package LICENSE                                                                         |
| pako 0.2.9                    | MIT                              | unicode-trie nested dependency; exact package LICENSE, retained in PDF/editor notices         |
| tslib 2.8.1                   | 0BSD                             | exact package LICENSE.txt and CopyrightNotice.txt                                             |

Fontkit/dfa/brotli do not ship a separate LICENSE file; their exact README and package.json explicitly declare MIT, and the upstream fontkit release README agrees. Retain those declarations and every supplied decoder copyright/header rather than inventing a missing copyright notice. The older @pdf-lib/fontkit archive was inspected but not adopted. Override pdf-lib's pako to the already-reviewed MIT 1.0.4 used by this product; reject the temporary review install's pako 1.0.11 (MIT AND Zlib, outside the allowlist at that review; Zlib was approved on 2026-10-18). Fonts remain the existing local OFL assets. PDF generation is lazy, offline and memory-only.
PDF verification only: pdfjs-dist 6.3.289 (Apache-2.0), @napi-rs/canvas 1.0.8 (MIT). Exact installed licenses inspected in the sibling tooling installation before adding test dependencies. These packages are not imported by product code or shipped in browser assets. Sources: https://github.com/mozilla/pdf.js and https://github.com/Brooooooklyn/canvas. Native canvas uses Skia (BSD-3-Clause); retained upstream package license for local verification.

## Equations and code blocks (2026-10-17)

KaTeX 0.19.0 is MIT licensed and PrismJS 1.30.0 is MIT licensed. The exact release manifests and notices were checked at the upstream [KaTeX 0.19.0 release](https://github.com/KaTeX/KaTeX/releases/tag/v0.19.0), [PrismJS v1.30.0 manifest](https://github.com/PrismJS/prism/blob/v1.30.0/package.json), and [PrismJS license](https://github.com/PrismJS/prism/blob/v1.30.0/LICENSE). KaTeX's local CSS references its own font files; those fonts are separately attributed under SIL OFL 1.1 in `licenses/font-license-notices.txt`. PrismJS has no runtime dependencies. KaTeX's CLI dependency `commander` is not imported by the editor renderer.

## Grid formula calculation (2026-10-18)

| Package/version                                                                       | Verified package license               | Authoritative evidence                                                                                                                                                        | Use                            |
| ------------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| [formualizer 0.11.1](https://registry.npmjs.org/formualizer/-/formualizer-0.11.1.tgz) | MIT, selected from `MIT OR Apache-2.0` | Exact npm archive `package.json`, `LICENSE-MIT`, `LICENSE-APACHE`; upstream [v0.11.1 WASM README](https://github.com/PSU3D0/formualizer/blob/v0.11.1/bindings/wasm/README.md) | Grid's lazy calculation worker |

The exact npm package reports no runtime dependencies and its archive was inspected locally; the browser WASM file is about 9.8 MB unpacked. The selected MIT notice is retained in `licenses/editor-license-notices.txt`. **Zlib approved by project policy on 2026-10-18; remaining compiled dependency audit pending:** follow-up inspection of the pinned Rust source, locked WASM dependency tree and installed binary identified embedded `zlib-rs 0.6.3`, licensed **Zlib**, now included in rule 06's allowlist with explicit user approval. Its path includes `formualizer-workbook → zip 7.2.0 → flate2 1.1.9 → zlib-rs`; the installed WASM contains matching crate source paths. The exact crate `LICENSE` was inspected. See [calculation evidence and hashes](docs/grid-compatibility.md) and the [exact crate license](https://docs.rs/crate/zlib-rs/0.6.3/source/LICENSE). The npm MIT option does not license all embedded code. The exact zlib-rs notice is retained in `licenses/editor-license-notices.txt` and included in the production license asset. The Zlib policy blocker is resolved; the rest of the compiled closure is not claimed cleared.
