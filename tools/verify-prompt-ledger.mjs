#!/usr/bin/env node
/**
 * AllSuite v3: a conservative structural check of a prompt's verification report.
 * Prompt V0 copies this to tools/verify-prompt-ledger.mjs in the repository.
 * Usage: node tools/verify-prompt-ledger.mjs G19
 * Standard-library-only, Node 22+.
 *
 * NOTE: This script checks report completeness/consistency, NOT whether
 * an agent's reported evidence is true. Independent reproduction is required.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const id = (process.argv[2] || '').toUpperCase();
if (!/^(?:S[0-8]|D[0-5]|G(?:[0-9]|1[0-9]|2[0-5]))$/.test(id)) {
  console.error('Usage: node tools/verify-prompt-ledger.mjs <S0..S8|D0..D5|G0..G25>');
  process.exit(2);
}

const root = resolve(process.cwd());
const promptDir = join(root, 'docs', 'ai', 'prompts');
const reportFile = join(root, 'docs', 'verification', `${id}.md`);

function fail(message, code = 1) {
  console.error(`FAIL ${id}: ${message}`);
  process.exit(code);
}

if (!existsSync(promptDir)) fail(`No ${promptDir}; install source prompts via V0.`, 2);
if (!existsSync(reportFile)) fail(`Missing verification report ${reportFile}.`, 1);
const promptFile = readdirSync(promptDir).filter((x) => x.endsWith('.md')).find((x) => {
  const text = readFileSync(join(promptDir, x), 'utf8');
  return text.includes(`MANDATORY ACCEPTANCE CRITERIA FOR ${id} (`);
});
if (!promptFile) fail(`Cannot locate authoritative AC list for ${id} in ${promptDir}.`, 2);

const promptText = readFileSync(join(promptDir, promptFile), 'utf8');
const anchor = `MANDATORY ACCEPTANCE CRITERIA FOR ${id} (`;
const start = promptText.indexOf(anchor);
const end = promptText.indexOf('---- ORIGINAL TASK SCOPE', start);
if (start < 0 || end < 0) fail('Original prompt acceptance block missing or malformed.', 2);
const acSection = promptText.slice(start, end);
const escaped = id.replace(/\d+/g, (m) => m); // id is validated above
const acRegex = new RegExp(`^- (AC-${escaped}-\\d{2}):\\s+(.+)$`, 'gm');
const criteria = [...acSection.matchAll(acRegex)].map((m) => m[1]);
if (criteria.length < 3 || new Set(criteria).size !== criteria.length) {
  fail(`Expected at least 3 unique acceptance IDs; parsed ${criteria.join(', ')}`, 2);
}

const report = readFileSync(reportFile, 'utf8');
const records = new Map();
for (const line of report.split(/\r?\n/)) {
  if (!/^\s*\|\s*AC-[SGD]\d+-\d{2}\s*\|/.test(line)) continue;
  const cells = line.split(/(?<!\\)\|/).map((v) => v.replace(/\\\|/g, '|').trim());
  if (cells.length < 8) fail(`Malformed AC row: ${line.slice(0, 120)}`);
  const [rid, requirement, status, implementation, evidence] = cells.slice(1);
  if (records.has(rid)) fail(`Duplicate report row for ${rid}`);
  records.set(rid, { requirement, status, implementation, evidence });
}
const problems = [];
for (const criterion of criteria) {
  const entry = records.get(criterion);
  if (!entry) { problems.push(`${criterion}: missing row`); continue; }
  if (entry.status !== 'DONE') {
    problems.push(`${criterion}: status ${entry.status} (must be DONE for gate PASS)`);
    continue;
  }
  const weak = (x) => !x || x.length < 12 || /^(?:[-–—]|n\/?a|none|not run|todo|unknown|tbd|pass|done)$/i.test(x);
  if (weak(entry.requirement)) problems.push(`${criterion}: requirement description too vague`);
  if (weak(entry.implementation)) problems.push(`${criterion}: missing concrete implementation evidence`);
  if (weak(entry.evidence)) problems.push(`${criterion}: missing concrete verification evidence`);
}
for (const rid of records.keys()) {
  if (rid.startsWith(`AC-${id}-`) && !criteria.includes(rid)) problems.push(`${rid}: unexpected ID, check modified requirements`);
}
const testsSection = report.split(/\n## Tests actually executed\s*\n/i)[1]?.split(/\n## /)[0] || '';
const ranCommands = testsSection.split(/\r?\n/).filter((line) => /^\s*\|/.test(line) && !/\bCommand\b|^\s*\|[\s:-]+\|/.test(line));
if (!ranCommands.some((line) => /\|\s*0\s*\|/.test(line))) {
  problems.push('No real command with recorded exit code 0 in "Tests actually executed" table');
}
if (!/\n## Gate verdict\s*\n\s*PASS\b/i.test(report)) {
  problems.push('Missing explicit "## Gate verdict" followed by PASS');
}
if (problems.length > 0) fail(problems.join('\n- '));
console.log(`STRUCTURAL PASS ${id}: ${criteria.length} mandatory criteria have DONE rows, non-empty evidence, and a logged successful command.`);
console.log('IMPORTANT: Structural PASS does not prove commands actually ran or the evidence is true. Run V3 independently.');
