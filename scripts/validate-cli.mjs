// CLI entry for the repo validator. NOT run directly — bundled by
// scripts/bundle-validator.mjs into ../garage/tools/validate.mjs (esbuild
// resolves the .ts core from this .mjs entry).
//
// Usage:  node validate.mjs [repo-dir] [--write]
// Checks: event schemas, id/date consistency, duplicate ids, strict fold
// cleanliness, garage.md freshness, pending claim parsability.
// --write: if all checks pass, regenerate garage.md from events/ and save it.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { validateRepo } from '../src/core/validate';
import { foldEvents } from '../src/core/state';
import { renderGarageMd } from '../src/core/render';

const args = process.argv.slice(2);
const writeMode = args.includes('--write');
const rootArg = args.find(a => !a.startsWith('--'));

const paths = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.isFile()) paths.push(p);
  }
})(rootArg ?? process.cwd());

const root = rootArg ?? process.cwd();
const files = [];
for (const p of paths) {
  const rel = relative(root, p).split(sep).join('/');
  if (!/\.(json|md|txt)$/i.test(rel)) continue;
  try {
    files.push({ path: rel, content: readFileSync(p, 'utf8') });
  } catch {
    /* unreadable — skip */
  }
}

let report = validateRepo(files);

// --write: a stale garage.md is expected; it is the thing we are about to fix.
const stalenessOnly =
  report.errors.length > 0 && report.errors.every(e => e.startsWith('garage.md is out of date'));

if (writeMode && (report.ok || stalenessOnly)) {
  const events = files
    .filter(f => f.path.startsWith('events/') && f.path.endsWith('.json'))
    .map(f => JSON.parse(f.content));
  const { state, issues } = foldEvents(events, { strict: true });
  const rendered = renderGarageMd(state);
  writeFileSync(join(root, 'garage.md'), rendered);
  console.log('  WROTE garage.md (regenerated from events/)');
  // re-check with the fresh file
  for (const f of files) if (f.path === 'garage.md') f.content = rendered;
  report = validateRepo(files);
  if (issues.length) for (const i of issues) report.warnings.push(`fold: ${i.message}`);
}

console.log(`\n=== GARAGE VALIDATE ${root} ===`);
console.log(`events: ${report.eventCount}   pending claims: ${report.pendingClaims}`);
for (const w of report.warnings) console.log(`  WARN  ${w}`);
for (const e of report.errors) console.log(`  ERROR ${e}`);
console.log(report.ok ? `OK — ${root}` : `FAIL — ${report.errors.length} error(s)`);
process.exit(report.ok ? 0 : 1);
