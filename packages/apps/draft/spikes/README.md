# Draft pagination laboratory

Two standalone prototypes investigate pagination approaches. They have no production route or imports from Draft runtime entries. No new dependencies are installed. Use the local browser benchmark and PDF review scripts to compare them. Evidence contains generated test content only.

`pagination-widgets` measures whole blocks and inserts ProseMirror decoration spacers. `pagination-print` leaves editing continuous and applies CSS paged media when printing. `pagination-shared` holds identical fixtures, schema, CSS, assertions and measurement tools. These files are experiments, not reusable production components.
