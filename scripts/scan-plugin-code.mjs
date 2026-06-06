// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Scan plugin JavaScript for code patterns that are either disallowed or worth a
// reviewer's attention. This is a coarse line scan, not a full parse: it strips
// `//` line comments to cut the obvious false positives and detects module use
// by its import/require (so a RegExp `.exec(` is never mistaken for a process
// exec). Node built-ins only, nothing to install or audit.
//
// Hard failures (the job fails):
//   - eval(...) or the Function(...) constructor, in any plugin (dynamic code
//     execution is never needed in a plugin).
//   - importing child_process in a theme / nav-style / shape plugin (the
//     presentation kinds have no business spawning processes).
//
// Advisory (printed for review, does not fail the job): network access, and
// child_process in a function plugin, so the high-privilege surface a plugin
// touches is visible during review. The real enforcement of these is the
// runtime capability model (see SpaceUX#426), not this scan.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const KINDS = ['function', 'theme', 'nav-style', 'shape'];

const HARD = [
  { re: /\beval\s*\(/, label: 'eval()' },
  { re: /\bFunction\s*\(/, label: 'Function() constructor' },
];
const CHILD_PROCESS =
  /(?:from\s+|require\(\s*)['"](?:node:)?child_process['"]/;
const NETWORK = [
  { re: /\bfetch\s*\(/, label: 'fetch()' },
  { re: /(?:from\s+|require\(\s*)['"](?:node:)?net['"]/, label: 'net module' },
  { re: /(?:from\s+|require\(\s*)['"](?:node:)?https?['"]/, label: 'http(s) module' },
];

function jsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFiles(p));
    else if (/\.(?:js|mjs|cjs)$/.test(entry.name)) out.push(p);
  }
  return out;
}

const errors = [];
const advisories = [];

for (const kind of KINDS) {
  if (!existsSync(kind)) continue;
  for (const name of readdirSync(kind)) {
    const dir = join(kind, name);
    if (!statSync(dir).isDirectory()) continue;
    for (const file of jsFiles(dir)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((raw, i) => {
        const line = raw.replace(/\/\/.*$/, '');
        const at = `${file}:${i + 1}`;
        for (const h of HARD) {
          if (h.re.test(line)) errors.push(`${at}: ${h.label}`);
        }
        if (CHILD_PROCESS.test(line)) {
          if (kind === 'function') advisories.push(`${at}: child_process`);
          else errors.push(`${at}: child_process is not allowed in a ${kind} plugin`);
        }
        for (const n of NETWORK) {
          if (n.re.test(line)) advisories.push(`${at}: ${n.label}`);
        }
      });
    }
  }
}

if (advisories.length > 0) {
  console.log('Advisory (high-privilege calls to review):');
  for (const a of advisories) console.log(`  - ${a}`);
  console.log('');
}

if (errors.length > 0) {
  console.error('Disallowed code patterns:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log('No disallowed code patterns found.');
