// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Regression tests for bridge.js, the brittle bits worth guarding: the
 * version-dir ranking, the legacy/sandbox/none resolution branches, and the
 * install ordering that protects an existing addon. No deps: run with
 * `node --test` from this directory.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, test } from 'node:test';

import {
  ADDON_NAME,
  bridgeInstalledAt,
  installAddon,
  resolveModDir,
  uninstallAddon,
} from './bridge.js';

const ADDON_SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'freecad');

let home;
beforeEach(() => {
  home = fsSync.mkdtempSync(path.join(os.tmpdir(), 'fc-bridge-test-'));
});
afterEach(async () => {
  await fs.rm(home, { recursive: true, force: true });
});

/** Make `<home>/<data>/FreeCAD` (plus any version subdirs) exist; returns the
 *  env to inject. With no names it creates just the base dir (legacy layout). */
function withDataDirs(...names) {
  const dataHome = path.join(home, '.local', 'share');
  fsSync.mkdirSync(path.join(dataHome, 'FreeCAD'), { recursive: true });
  for (const name of names) fsSync.mkdirSync(path.join(dataHome, 'FreeCAD', name), { recursive: true });
  return { XDG_DATA_HOME: dataHome };
}

test('resolveModDir picks the highest versioned dir', () => {
  const env = withDataDirs('v0-21', 'v1-1', 'v1-2');
  const r = resolveModDir(home, env);
  assert.equal(r.ok, true);
  assert.equal(r.label, 'v1-2');
  assert.ok(r.modDir.endsWith(path.join('v1-2', 'Mod')));
});

test('resolveModDir ranks by major then minor, ignoring non-version dirs', () => {
  const env = withDataDirs('v2-0', 'v1-9', 'Macro', 'Mod');
  const r = resolveModDir(home, env);
  assert.equal(r.label, 'v2-0');
});

test('resolveModDir falls back to the legacy unversioned layout', () => {
  const env = withDataDirs(); // creates <data>/FreeCAD with no version dirs
  const r = resolveModDir(home, env);
  assert.equal(r.ok, true);
  assert.equal(r.label, 'unversioned');
});

test('resolveModDir reports the Flatpak/Snap sandbox as unsupported', () => {
  fsSync.mkdirSync(path.join(home, '.var', 'app', 'org.freecad.FreeCAD'), { recursive: true });
  const r = resolveModDir(home, { XDG_DATA_HOME: path.join(home, 'empty') });
  assert.equal(r.ok, false);
  assert.match(r.reason, /Flatpak\/Snap/);
});

test('resolveModDir reports no FreeCAD found when nothing is present', () => {
  const r = resolveModDir(home, { XDG_DATA_HOME: path.join(home, 'empty') });
  assert.equal(r.ok, false);
  assert.match(r.reason, /No FreeCAD user data directory found/);
});

test('installAddon copies the addon, skipping __pycache__, with no staging leftover', async () => {
  const modDir = path.join(home, 'Mod');
  const res = await installAddon(ADDON_SRC, modDir);
  assert.equal(res.ok, true);
  assert.equal(bridgeInstalledAt(modDir), true);
  assert.equal(fsSync.existsSync(path.join(modDir, ADDON_NAME, '__pycache__')), false);
  assert.equal(fsSync.existsSync(path.join(modDir, `.${ADDON_NAME}.tmp`)), false);
});

test('installAddon leaves an existing addon intact when the source is missing', async () => {
  const modDir = path.join(home, 'Mod');
  const dest = path.join(modDir, ADDON_NAME);
  fsSync.mkdirSync(dest, { recursive: true });
  fsSync.writeFileSync(path.join(dest, 'sentinel'), 'existing');

  const res = await installAddon(path.join(home, 'no-such-source'), modDir);
  assert.equal(res.ok, false);
  assert.equal(fsSync.existsSync(path.join(dest, 'sentinel')), true);
  assert.equal(fsSync.existsSync(path.join(modDir, `.${ADDON_NAME}.tmp`)), false);
});

// Root bypasses file permissions, so the unreadable-file trick can't force the
// copy to fail there; skip rather than assert a guarantee we can't provoke.
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
test(
  'installAddon leaves an existing addon intact when the copy fails midway',
  { skip: isRoot ? 'needs non-root to enforce file permissions' : false },
  async () => {
    const modDir = path.join(home, 'Mod');
    const dest = path.join(modDir, ADDON_NAME);
    fsSync.mkdirSync(dest, { recursive: true });
    fsSync.writeFileSync(path.join(dest, 'sentinel'), 'existing');

    // A source tree with an unreadable file → fs.cp rejects partway through.
    const src = path.join(home, 'badsrc');
    fsSync.mkdirSync(src, { recursive: true });
    fsSync.writeFileSync(path.join(src, 'ok.py'), 'readable');
    const locked = path.join(src, 'locked.py');
    fsSync.writeFileSync(locked, 'secret');
    fsSync.chmodSync(locked, 0o000);

    const res = await installAddon(src, modDir);
    assert.equal(res.ok, false);
    // The existing install must survive: the copy never touched dest.
    assert.equal(fsSync.existsSync(path.join(dest, 'sentinel')), true);
    assert.equal(fsSync.existsSync(path.join(modDir, `.${ADDON_NAME}.tmp`)), false);
  },
);

test('uninstallAddon removes the addon and is idempotent', async () => {
  const modDir = path.join(home, 'Mod');
  await installAddon(ADDON_SRC, modDir);
  assert.equal((await uninstallAddon(modDir)).ok, true);
  assert.equal(bridgeInstalledAt(modDir), false);
  assert.equal((await uninstallAddon(modDir)).ok, true); // already gone
});
