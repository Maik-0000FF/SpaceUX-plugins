// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Scan plugin JavaScript for code patterns that are either disallowed or worth a
// reviewer's attention. This is a coarse scan, not a full parse, but it is
// comment- and string-aware: `//` and `/* */` comments are blanked (so a doc
// comment mentioning eval() does not fail the build) while string contents are
// kept (so a module name in an import string is still detected). Module use is
// matched by its import/require/import() rather than by a method call, so a
// RegExp `.exec()` is never mistaken for a process exec. Node built-ins only.
//
// Known limitation: because string contents are kept, a string literal that
// itself contains the text "eval(" or "Function(" can false-positive. That is
// rare and usually worth a look anyway (building code as a string). The real
// enforcement of these privileges is the runtime capability model (SpaceUX#426),
// not this scan.
//
// Hard failures (the job fails):
//   - eval(...) or the Function(...) constructor, in any plugin.
//   - importing child_process in a theme / nav-style / shape plugin.
//
// Advisory (printed for review, does not fail): network access, and
// child_process in a function plugin (which should prefer the host's
// ctx.launch over a raw spawn, so the program runs in its own systemd scope).

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const KINDS = ['function', 'theme', 'nav-style', 'shape'];

const HARD = [
  { re: /\beval\s*\(/, label: 'eval()' },
  { re: /\bFunction\s*\(/, label: 'Function() constructor' },
];
const MODULE = (name) =>
  new RegExp(`(?:from\\s+|require\\(\\s*|import\\(\\s*)['"](?:node:)?${name}['"]`);
const CHILD_PROCESS = MODULE('child_process');
const NETWORK = [
  { re: /\bfetch\s*\(/, label: 'fetch()' },
  { re: MODULE('net'), label: 'net module' },
  { re: MODULE('https?'), label: 'http(s) module' },
];

// Blank // and /* */ comments (preserving newlines and length so line numbers
// stay correct) while leaving string and template-literal contents intact.
function blankComments(src) {
  let out = '';
  let state = 'code'; // code | line | block | sq | dq | tpl
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const d = src[i + 1];
    if (state === 'code') {
      if (c === '/' && d === '/') {
        out += '  ';
        i++;
        state = 'line';
      } else if (c === '/' && d === '*') {
        out += '  ';
        i++;
        state = 'block';
      } else if (c === "'") {
        out += c;
        state = 'sq';
      } else if (c === '"') {
        out += c;
        state = 'dq';
      } else if (c === '`') {
        out += c;
        state = 'tpl';
      } else {
        out += c;
      }
    } else if (state === 'line') {
      if (c === '\n') {
        out += '\n';
        state = 'code';
      } else {
        out += ' ';
      }
    } else if (state === 'block') {
      if (c === '*' && d === '/') {
        out += '  ';
        i++;
        state = 'code';
      } else {
        out += c === '\n' ? '\n' : ' ';
      }
    } else {
      // string / template literal: copy verbatim, honour escapes, find the end
      const quote = state === 'sq' ? "'" : state === 'dq' ? '"' : '`';
      if (c === '\\') {
        out += c + (d ?? '');
        i++;
      } else if (c === quote) {
        out += c;
        state = 'code';
      } else {
        out += c;
      }
    }
  }
  return out;
}

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
      const lines = blankComments(readFileSync(file, 'utf8')).split('\n');
      lines.forEach((line, i) => {
        const at = `${file}:${i + 1}`;
        for (const h of HARD) {
          if (h.re.test(line)) errors.push(`${at}: ${h.label}`);
        }
        if (CHILD_PROCESS.test(line)) {
          if (kind === 'function')
            advisories.push(`${at}: child_process (prefer ctx.launch for scope-decoupled launching)`);
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
