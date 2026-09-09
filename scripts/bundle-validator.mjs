// Bundles the shared core + CLI into garage/tools/validate.mjs so the data
// repo carries one self-contained validator (same code the PWA runs).
// Run:  node scripts/bundle-validator.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(here, '..');
const outFile = path.join(appRoot, '..', 'garage', 'tools', 'validate.mjs');

fs.mkdirSync(path.dirname(outFile), { recursive: true });
await build({
  entryPoints: [path.join(here, 'validate-cli.mjs')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outfile: outFile,
  legalComments: 'none',
  logLevel: 'info',
});
console.log(`validator → ${path.relative(process.cwd(), outFile)}`);
