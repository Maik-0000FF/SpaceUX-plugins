<!--
SPDX-FileCopyrightText: Maik-0000FF
SPDX-License-Identifier: GPL-3.0-or-later
-->

# Contributing to SpaceUX-plugins

This repo holds official and community plugins for
[SpaceUX](https://github.com/Maik-0000FF/SpaceUX). A plugin is a small,
self-describing directory; this document covers how to add one and the checks
every contribution goes through.

Please read [Plugin security](#plugin-security) before submitting: a plugin is
code that the app loads and runs with the user's privileges, so contributions
are reviewed with that in mind.

## Repository layout

Plugins live under a folder named after their kind:

```
function/      actions the pie can run (an index.js with handlers)
theme/         pie styling
nav-style/     navigation-gesture presets (data only)
shape/         a pie shape model (an index.js entry)
```

Each plugin is its own directory containing a `manifest.json` and, for the kinds
that ship code, an `index.js`. Every tracked file carries an SPDX header, e.g.:

```js
// SPDX-FileCopyrightText: Your Name
// SPDX-License-Identifier: GPL-3.0-or-later
```

The SPDX header is a required convention checked in review, not by an automated
gate, so a missing one will not fail CI but will be asked for.

## The manifest

`manifest.json` is validated in CI (`scripts/validate-plugins.mjs`). Required
fields, common to every kind:

| Field        | Notes                                                       |
| ------------ | ----------------------------------------------------------- |
| `apiVersion` | `1`                                                         |
| `kind`       | `function` \| `theme` \| `nav-style` \| `shape`; must match the folder it lives in |
| `id`         | reverse-DNS, unique across the repo (e.g. `org.example.my-plugin`) |
| `name`       | human-readable name                                         |
| `version`    | semver (`0.1.0`)                                            |
| `license`    | an SPDX id (`GPL-3.0-or-later`)                             |

Kind-specific payload:

- `function`: an `actions` array.
- `nav-style`: a `presets` array.
- `shape`: a `shape` object whose `entry` points at the plugin's `index.js`.
- `theme`: no extra payload for now, the common fields only; the styling lives
  in the plugin's own files.

Optional `permissions`: an array declaring the sensitive things your plugin
needs, any of `exec` (run external programs), `network` (sockets / HTTP),
`filesystem` (write outside its own data folder), `inject-keys` (synthesise
keyboard input). Declare only what you actually use; the app shows these to the
user before they enable the plugin. Unknown values and duplicates are rejected.

See the existing plugins for complete examples.

## What CI checks

Open a pull request and these run automatically:

- **manifest validation**: the schema above, the `kind`/folder match, unique ids.
- **no binaries**: no compiled or opaque artefacts may be committed (no ELF,
  shared libraries, object files, or bytecode such as `.pyc`).
- **code scan** (`scripts/scan-plugin-code.mjs`): hard-fails on dynamic code
  execution (`eval`, the `Function` constructor) in any plugin, and on importing
  `child_process` in a `theme` / `nav-style` / `shape` plugin. Network access and
  `child_process` in a `function` plugin are listed for the reviewer.
- **gitleaks**: no secrets in the history.
- **CodeQL**: static security analysis of the plugin source.

## Plugin security

A plugin's `index.js` is executed by the app with the user's privileges
(filesystem, network, subprocesses, the device). Treat that responsibility
seriously:

- Do only what your plugin describes. A `function` launcher may spawn processes;
  a `theme`, `nav-style`, or `shape` plugin should not.
- No dynamic code execution (`eval`, `new Function`) and no obfuscation
  (encoded blobs that hide what the code does).
- Keep dependencies to a minimum, ideally none.

A runtime capability model that makes these limits enforced rather than
reviewed is in progress
([SpaceUX#426](https://github.com/Maik-0000FF/SpaceUX/issues/426)); until then,
review is the main safeguard, so keep your plugin easy to read.

## Official vs community

- **Official** plugins (the `org.spaceux.*` ids) are maintained here and
  reviewed by the maintainers.
- **Community** plugins are welcome and go through the same CI and review. They
  carry their own author and reverse-DNS id, and the app shows their origin so
  users know what they are enabling.

## Submitting

1. Add your plugin directory under the right kind folder with a valid manifest
   and SPDX headers.
2. Run the checks locally if you can:
   ```sh
   node scripts/validate-plugins.mjs
   node scripts/scan-plugin-code.mjs
   ```
3. Open a pull request. Keep it to one plugin (or one focused change) so it is
   easy to review.

By contributing you agree to license your contribution under
`GPL-3.0-or-later`.
