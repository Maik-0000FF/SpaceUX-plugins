// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Example plugin: launch an arbitrary command.
 *
 * Demonstrates the minimum shape a plugin handler must take: a named
 * export of `actions` mapping the action.name strings from manifest.json
 * to an async (or sync) function that receives the per-instance config
 * the user filled in via the editor.
 *
 * Launching goes through `ctx.launch(command)`, the host capability that
 * tokenises the command line shlex-style (whitespace splits, quotes group, so
 * a path with spaces must be quoted) and runs the program in its own systemd
 * scope. Prefer it over importing `node:child_process`: a raw detached spawn
 * inherits SpaceUX's scope and can stall session logout while systemd waits on
 * the launched app (SpaceUX#522).
 */

async function launch(config, ctx) {
  const command = typeof config.command === 'string' ? config.command.trim() : '';
  if (!command) {
    ctx.log('no command configured');
    return;
  }
  ctx.launch(command);
}

export const actions = {
  launch,
};

/**
 * Dynamic menu provider (#76 C2). The host calls this at *each* pie open (with
 * a timeout) and renders the returned root, so the menu can reflect live state:
 * a real plugin (e.g. FreeCAD) would query external context here. This demo
 * stamps the current time into a label to prove the tree is rebuilt per open
 * rather than served from the static `manifest.menu`. The action id must be the
 * composite `<pluginId>/<action>` so the host resolves it, same as the manifest
 * menu. Returns the pie's root MenuNode (its `branches` are the sectors).
 */
export function provideMenu(ctx) {
  const now = new Date().toLocaleTimeString();
  ctx.log(`building dynamic menu (${now})`);
  return {
    label: '',
    branches: [
      {
        label: 'Files',
        action: { id: 'org.spaceux.example-launch/launch', config: { command: 'xdg-open .' } },
      },
      {
        label: 'Browser',
        action: {
          id: 'org.spaceux.example-launch/launch',
          config: { command: 'xdg-open https://example.com' },
        },
      },
      // No-op leaf whose label changes every open: visible proof the provider
      // runs live instead of the menu being a cached static tree.
      { label: now },
    ],
  };
}
