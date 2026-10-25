# AllSuite — Evidence-First Execution Contract v3

> Canonical source: `docs/ai/rules/EXECUTION_CONTRACT.md`. Prompt V0 installs an active copy under `.agents/rules/08-evidence-first-verification.md` (or the next unused free number) and links it from `AGENTS.md`. Preserve stronger existing rules.
>
> No instruction, self-reported confidence, test summary or passing CI badge is a substitute for inspected code and reproduced user behavior.

## 1. Truthful status is more important than completion

Use **only** these states for each atomic requirement:

| State | Permitted meaning | Evidence required |
|---|---|---|
| `DONE` | Implementation exists **and** the specified acceptance behavior was actually verified against this worktree | Exact code path/symbol, specific test/scenario, command + exit code + relevant output, artifact if applicable |
| `PARTIAL` | Some behavior exists, but an acceptance criterion or verification is missing/failed | What works, what fails or was not checked, smallest reproducible case |
| `NOT DONE` | Requirement has not been implemented | Location searched, missing behavior and what remains |
| `BLOCKED` | Work/verification was attempted, but an external or technical blocker stopped it | Attempted command/action, exact failure, proposed unblock |
| `DEFERRED (USER APPROVED)` | The user explicitly approved deferral of this exact requirement | User decision and its scope; not an agent's unilateral choice |

An acceptance test that was **not run**, was skipped, was mocked at the wrong boundary, or failed is **not** passing. `DONE` is forbidden if there is only a component, a type declaration, a README claim, a fixture generated to match the implementation, or a green unrelated test suite.

**Never state** “implemented”, “fully supported”, “preserved”, “safe to save”, “compatible”, “verified in LibreOffice”, “works offline”, “all prompts completed”, or “no regressions” without appropriately scoped proof. Never invent command output, evidence paths, screenshots, external app launches, file-system paths, or previous agent actions.

## 2. Existing claims are hypotheses, not proof

At task start inspect the **current checkout**, not prior chat summaries. Record `git status --short`, `git rev-parse HEAD`, changed paths and relevant source locations. Compare implementation and tests to the requirements. Mark inherited functionality `UNVERIFIED` in working notes until inspected; in the final matrix classify it as one of the states above. Do not blindly trust previous status files, an AI completion message, README or tests that prove only trivial cases.

If a prerequisite or a claimed earlier prompt is incomplete, **report the mismatch**, fix it only when permitted by the current scope, and stop at the relevant gate. Do not quietly skip ahead.

## 3. Requirements traceability (no grouping away missing work)

Before modifying production code, create or update `docs/verification/<PROMPT_ID>.md` with one row per **atomic** user-visible or safety requirement. The supplied prompt's `AC-...` IDs are mandatory minimum rows; split any broader clause into additional rows. Copy these ID values verbatim. Columns:

`ID | Requirement | Status | Implementation evidence | Verification evidence | Remaining risk`

Do **not** merge “XLSX tables and notes” into one row, or count “import/export” as fulfilled by a one-way parser. Conditional features need an explicit decision; never quietly mark a missing feature `DONE` just because its toolbar exists.

For every item report **implementation separately from verification**. Example: `PARTIAL: import works; export drops vmlDrawing relationship; failing case: ...`.

## 4. Prove observable outcomes across boundaries

For user-visible operations, verify the actual flow, not only internal helpers. For file-backed features, prefer:

`construct/open fixture → inspect initial content → edit → save/export → reopen using the app importer → compare semantic results and underlying package parts → optionally validate in an external office application`

A save success toast is not evidence that output contains the edited element. A file that opens in the same parser is not sufficient proof that all original unsupported features survived. Verify bytes/structure (ZIP parts, OOXML relationships, metadata, VML where relevant) **and** user-visible behavior. Use deliberately tricky positive and negative fixtures, including cancellation, malformed input, unsupported elements and undo/redo.

For UI behavior, use a browser interaction test or a witnessed manual repro, not just RTL shallow rendering. For performance, measure before and after with the same scenario and report the environment. For external editor claims, provide the actual command/tool, version, output and artifact; otherwise mark cross-app validation `BLOCKED` or `NOT DONE`, never `DONE`.

## 5. Cross-feature verification is compulsory

Changes to serialization, structural edits, clipboard, formula references, comment anchors, workbook relationships, undo/redo or command routing can break unrelated features. For each such change run targeted tests of neighboring features and a smoke test in **both** Draft and Grid where shared workspace code changed. Track any regression as `PARTIAL` or `NOT DONE` even if new-feature tests pass.

Critical safety invariants: user documents/workbooks stay in memory except explicit user-initiated file operations; no implicit IndexedDB/localStorage/Cache persistence of document contents; no service-worker precache of user files; no uploads/telemetry/CDNs; existing dirty/navigation protection remains reliable; no shell eager imports of heavy app dependencies; no opaque XLSX/DOCX data silently dropped.

## 6. Tests may not be manipulated into a false green

Do not skip/delete/disable a failing test or relax assertions merely to make the pipeline pass. Do not catch and swallow an exception to force a green result. Do not substitute snapshots for semantic checks. If a test truly had an incorrect expectation, record **before/after**, why it was incorrect and independent evidence of intended behavior. Adding `TODO` or a warning does not satisfy a requirement whose acceptance criteria demand functional behavior.

Run commands directly in this checkout. Report their exact spelling, scope, exit code, pass/fail counts and *relevant* failures, including whether a script was missing or never started. Do not say “all checks passed” if any required command was skipped. Do not claim visual/manual checks were run without a browser.

## 7. Be explicit about scope and protected code

Read `AGENTS.md` and existing `.agents/` rules first. Respect the current monorepo, `@all/ui` primitives, the chosen editor-workspace ADR and existing Draft/Grid engines. Never rewrite a working engine or introduce a second command/clipboard/parser implementation merely to satisfy a prompt. Never silently broaden scope, overwrite unrelated local changes, create commits or push unless the user specifically requested them.

Use separate layers for UI composition, editing engine, file codecs and fidelity policies. “Reusable” means demonstrably reused without app-specific coupling, not gratuitous abstractions.

## 8. Evidence log protocol

Maintain `docs/verification/<PROMPT_ID>.md` using this exact skeleton (add rows as necessary):

```markdown
# Verification <PROMPT_ID>
- Baseline HEAD: `<SHA>`; working tree: `<status>`; checked on: `<date>`
- Scope: ...
- Prerequisites reviewed: ...

| ID | Requirement | Status | Implementation (path + symbol) | Evidence (test/command, exit code, observed result) | Gap/risk |
|---|---|---|---|---|---|
| AC-... | ... | PARTIAL | ... | Not yet run | ... |

## Tests actually executed
| Command | Exit code | Observed result | Log/report path |
|---|---:|---|---|

## User flows reproduced
| Scenario | Action and input | Actual observed result | Verdict |
|---|---|---|---|

## Changes to tests or assertions
- ... (or `none`)

## Known limitations and regressions
- ... (or `none observed within tests run`; NEVER claim global absence)

## Gate verdict
PASS / FAIL / BLOCKED, with explanation.
```

Before claiming a passing gate, run `node tools/verify-prompt-ledger.mjs <PROMPT_ID>` if installed by V0. A structural PASS only checks the report, not whether its claims are true. A script failure means gate FAIL until the requirements matrix is corrected and the required behavior actually verified.

Proof references should be reviewable in the current checkout: precise paths and test names; where practical provide commands a second agent can rerun. Filenames and screenshot references must be files that actually exist. Do not fabricate line numbers; only supply them after looking at the file in this checkout.

## 9. Mandatory completion format in the final agent answer

Always answer in this sequence:

1. **What changed:** concrete changed paths and observable behavior.
2. **Requirements matrix:** *all* `AC-...` IDs and any expanded requirements, with `DONE/PARTIAL/NOT DONE/BLOCKED/DEFERRED (USER APPROVED)` and a short code/test proof per row.
3. **Commands actually run:** exact commands, exit codes, pass/fail/skip counts. Explicitly identify commands not run and why.
4. **Known missing behavior, possible data loss and regressions:** list them, even if that means this task failed.
5. **Gate verdict:** `PASS` only when all mandatory acceptance cases were observed and required checks passed. Otherwise `FAIL` or `BLOCKED` and **do not recommend advancing**.

Avoid vague blanket success statements. “I believe”, “should work”, “probably”, “already implemented”, or “all done” do not establish proof. A partial but truthful result is preferable to fabricated completion.

## 10. Hard stop / no silent scope reduction

If an `AC-...` criterion remains failed or unverified, do not mark the prompt complete; do not move on to the next prompt or release gate. When a blocker cannot be resolved, produce the partial results and request user direction only for the missing decision. Never replace an acceptance criterion with a note in README or a narrower test and then report the original criterion as done.

**Special safety rule for XLSX:** “preserved native tables/legacy notes/VML” is `DONE` only with tests proving the actual OOXML parts, namespaces, relationships, metadata and edit/save/reopen behavior for the specified supported subset. If preservation is unsafe, saving must be blocked or require an explicit safe alternative **before** writing. Unchanged bytes in a ZIP alone are insufficient if their parent/child relationships have been dropped.

**Special safety rule for DOCX:** “preserved comments/changes” is `DONE` only with round-trip checks of the relevant markup and relationships; keeping text visible is not equivalent to preserving review semantics.
