// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Validate every plugin manifest in this repo so a malformed or mislabelled
// plugin fails CI rather than at load time in the app. Uses only Node built-ins
// (no dependencies, nothing to audit). Run: node scripts/validate-plugins.mjs
//
// Checks, per plugin directory under each category folder:
//   - manifest.json exists and is valid JSON
//   - kind matches the parent category directory (a plugin can't claim a kind
//     it isn't filed under)
//   - required common fields are present (apiVersion, kind, id, name, version,
//     license)
//   - id is reverse-DNS and unique across the repo; version is semver
//   - the kind-specific payload is present (function->actions, nav-style->
//     presets, shape->shape) and a shape's entry file exists

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const KINDS = ['function', 'theme', 'nav-style', 'shape'];
const ID_RE = /^[a-z0-9]+(\.[a-z0-9-]+)+$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+].+)?$/;

const errors = [];
const seenIds = new Map();

for (const kind of KINDS) {
  if (!existsSync(kind)) continue;
  for (const name of readdirSync(kind)) {
    const dir = join(kind, name);
    if (!statSync(dir).isDirectory()) continue;

    const manifestPath = join(dir, 'manifest.json');
    if (!existsSync(manifestPath)) {
      errors.push(`${dir}: missing manifest.json`);
      continue;
    }

    let m;
    try {
      m = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (err) {
      errors.push(`${manifestPath}: invalid JSON (${err.message})`);
      continue;
    }

    for (const field of ['apiVersion', 'kind', 'id', 'name', 'version', 'license']) {
      if (m[field] === undefined || m[field] === null || m[field] === '') {
        errors.push(`${manifestPath}: missing "${field}"`);
      }
    }

    if (m.apiVersion !== 1) errors.push(`${manifestPath}: apiVersion must be 1`);
    if (m.kind !== kind) {
      errors.push(`${manifestPath}: kind "${m.kind}" does not match its directory "${kind}"`);
    }
    if (m.id && !ID_RE.test(m.id)) {
      errors.push(`${manifestPath}: id "${m.id}" is not reverse-DNS (e.g. org.example.name)`);
    }
    if (m.version && !SEMVER_RE.test(m.version)) {
      errors.push(`${manifestPath}: version "${m.version}" is not semver`);
    }

    if (kind === 'function' && !Array.isArray(m.actions)) {
      errors.push(`${manifestPath}: function plugin needs an "actions" array`);
    }
    if (kind === 'nav-style' && !Array.isArray(m.presets)) {
      errors.push(`${manifestPath}: nav-style plugin needs a "presets" array`);
    }
    if (kind === 'shape') {
      if (typeof m.shape !== 'object' || m.shape === null) {
        errors.push(`${manifestPath}: shape plugin needs a "shape" object`);
      } else if (m.shape.entry && !existsSync(join(dir, m.shape.entry))) {
        errors.push(`${manifestPath}: shape.entry "${m.shape.entry}" not found in ${dir}`);
      }
    }

    if (m.id) {
      if (seenIds.has(m.id)) {
        errors.push(`${manifestPath}: duplicate id "${m.id}" (also in ${seenIds.get(m.id)})`);
      } else {
        seenIds.set(m.id, manifestPath);
      }
    }

    console.log(`ok: ${dir} (${m.id ?? '?'})`);
  }
}

if (errors.length > 0) {
  console.error('\nManifest validation failed:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`\nAll plugin manifests valid (${seenIds.size} plugins).`);
