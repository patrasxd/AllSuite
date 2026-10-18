# Licenses and Branding in AllSuite

## Dependency license gate

Allowlist: **MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC, SIL OFL (OFL-1.1), 0BSD, Zlib**. Forbidden: GPL, AGPL, SSPL, commercial-only and source-available licenses. Unknown/unverified licenses do not pass. For dual licensing, verify and record the allowed option used.

Before adding dependencies, check exact-version license files and authoritative upstream sources. Review required transitive dependencies and redistributed assets too. Check **each Tiptap extension separately**; the core license does not establish extension or paid-offering licenses.

Record package/version, chosen license and source in repository-root `THIRD_PARTY_LICENSES.md`, including required notices. The current inventory covers editor packages and their runtime dependencies; it is not a completed audit of every pre-existing shell/toolchain package. Retain distributed notices in `licenses/` and the production license asset. Dependency tasks must create/update the inventory and notices with evidence before adding packages. Do not add dependencies outside the allowlist.

## Independent product identity

Do not use Microsoft Office, Adobe or Google product names, logos, icons, wording or ribbon look in AllSuite UI, code or docs. Use AllSuite's own names, original vector icons and simple toolbar built from `@all/ui`; do not imitate proprietary artwork or branded interface composition. Generic actions such as New/Open/Save and standard format identifiers are appropriate.

No proprietary font files in the repository. Use locally bundled fonts with verified allowlisted licenses and retain notices; no external font requests. Preserve established AllSuite/AllUI catalog and header conventions without proprietary branding.
