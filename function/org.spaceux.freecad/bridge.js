// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * FreeCAD-side bridge-addon install logic, owned by the plugin (SpaceUX #288).
 *
 * The bridge addon (this plugin's `freecad/` folder) must live in FreeCAD's
 * user `Mod/` directory, which is version-specific (FreeCAD 1.2 →
 * `~/.local/share/FreeCAD/v1-2/Mod/`) and packaging-specific. We can't ask
 * FreeCAD, so we resolve it from the filesystem: the highest `vMAJOR-MINOR/`
 * data dir, else a legacy unversioned layout. Flatpak/Snap are reported
 * unsupported, because the bridge's UNIX socket can't cross the sandbox boundary.
 *
 * This moved out of the SpaceUX core (#288): the host now drives a generic
 * `provideBridge` hook and never names FreeCAD, so all of FreeCAD's path/IO
 * specifics live here in the plugin.
 */

import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** A `vMAJOR-MINOR` FreeCAD data-dir name (e.g. `v1-2`). */
const VERSION_DIR_RE = /^v(\d+)-(\d+)$/;

/** The subdir the addon is installed as under `Mod/`. */
export const ADDON_NAME = 'SpaceUX';

// Treat any stat error as "not a directory". This deliberately collapses a
// permission-denied (EACCES) dir into the same "absent" result as a missing
// one: the common case is absence, and either way the bridge can't be used
// there, so the resolver reports it the same.
function isDir(p) {
  try {
    return fsSync.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function describeError(err) {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Resolve FreeCAD's user `Mod/` directory by scanning the filesystem. Order:
 *   1. the highest versioned data dir, `<data>/FreeCAD/v<MAJ>-<MIN>/Mod`;
 *   2. the legacy unversioned `<data>/FreeCAD/Mod` (older FreeCAD);
 *   3. the very old `~/.FreeCAD/Mod`.
 * Returns the resolved Mod path (which may not exist yet; install creates it)
 * plus a short human label, or a failure reason (a Flatpak/Snap install the
 * socket can't reach, or no FreeCAD data dir at all).
 */
export function resolveModDir(home = os.homedir(), env = process.env) {
  const dataHome = env.XDG_DATA_HOME || path.join(home, '.local', 'share');
  const base = path.join(dataHome, 'FreeCAD');

  // 1. Highest versioned dir (v1-2 > v1-1 > v0-21).
  let best = null;
  let entries = [];
  try {
    entries = fsSync.readdirSync(base);
  } catch {
    entries = [];
  }
  for (const name of entries) {
    const m = VERSION_DIR_RE.exec(name);
    if (m === null || !isDir(path.join(base, name))) continue;
    const major = Number(m[1]);
    const minor = Number(m[2]);
    if (best === null || major > best.major || (major === best.major && minor > best.minor)) {
      best = { major, minor, name };
    }
  }
  if (best !== null) return { ok: true, modDir: path.join(base, best.name, 'Mod'), label: best.name };

  // 2./3. Legacy unversioned layouts.
  if (isDir(base)) return { ok: true, modDir: path.join(base, 'Mod'), label: 'unversioned' };
  const dotFreecad = path.join(home, '.FreeCAD');
  if (isDir(dotFreecad)) return { ok: true, modDir: path.join(dotFreecad, 'Mod'), label: '~/.FreeCAD' };

  // Sandboxed installs: the socket can't cross the boundary, so the bridge
  // can't work there; report rather than install into a dead end.
  const sandboxed =
    isDir(path.join(home, '.var', 'app', 'org.freecad.FreeCAD')) ||
    isDir(path.join(home, 'snap', 'freecad'));
  if (sandboxed) {
    return {
      ok: false,
      reason:
        "FreeCAD is installed as Flatpak/Snap, so the bridge's socket can't cross the sandbox. Use a native or AppImage FreeCAD, or set it up manually.",
    };
  }
  return {
    ok: false,
    reason: 'No FreeCAD user data directory found. Install FreeCAD and run it once.',
  };
}

/** Whether the addon is installed in `modDir` (a `SpaceUX/` dir is present). */
export function bridgeInstalledAt(modDir) {
  return isDir(path.join(modDir, ADDON_NAME));
}

/**
 * Copy the addon (`srcAddonDir` = this plugin's `freecad/`) to
 * `<modDir>/SpaceUX`, replacing any existing install (so a re-run updates it)
 * and skipping `__pycache__`. The Mod dir is created if missing.
 *
 * Staged: copy into a sibling temp dir first, then swap it in with a single
 * rename. So a copy that fails partway (ENOSPC, EACCES, a partial tree) leaves
 * the previous working install untouched rather than half-overwritten. The
 * destination is only removed once the staged copy fully succeeded.
 */
export async function installAddon(srcAddonDir, modDir) {
  const dest = path.join(modDir, ADDON_NAME);
  const staging = path.join(modDir, `.${ADDON_NAME}.tmp`);
  // Guard the addon source up front so a misconfigured plugin (no bundled
  // freecad/ dir) gives a clear reason rather than a raw ENOENT from cp.
  if (!isDir(srcAddonDir)) {
    return { ok: false, reason: `bridge addon not found in the plugin (${srcAddonDir})` };
  }
  try {
    await fs.mkdir(modDir, { recursive: true });
    await fs.rm(staging, { recursive: true, force: true });
    await fs.cp(srcAddonDir, staging, {
      recursive: true,
      filter: (src) => !src.split(path.sep).includes('__pycache__'),
    });
    // Copy is complete; now the swap is just a remove + rename (same dir, so
    // the rename is atomic on the one filesystem).
    await fs.rm(dest, { recursive: true, force: true });
    await fs.rename(staging, dest);
    return { ok: true, dest };
  } catch (err) {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    return { ok: false, reason: describeError(err) };
  }
}

/** Remove the installed addon (`<modDir>/SpaceUX`). A missing dir is success. */
export async function uninstallAddon(modDir) {
  try {
    await fs.rm(path.join(modDir, ADDON_NAME), { recursive: true, force: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: describeError(err) };
  }
}
