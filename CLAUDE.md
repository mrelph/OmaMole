# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

## Commands

```bash
pnpm install          # pnpm 11; pnpm-workspace.yaml declines esbuild/electron build scripts
pnpm dev              # tsc watch (main) + Vite (renderer) + system Electron
pnpm build            # dist-electron/ (tsc) + dist/ (vite)
pnpm start            # run the built app on the system electron (scripts/electron.sh)
pnpm typecheck        # renderer + main tsconfigs, no emit — the main gate
pnpm test             # vitest, tests/*.test.ts — pure logic + temp-dir filesystem tests
bash -n helper/omamole-helper   # shellcheck is not installed here; at least syntax-check
```

The app runs on the **system Electron** (`electron43` on Arch), never a bundled
one; the `electron` devDependency exists for its types only.

## Architecture

Electron main process does all system work; the renderer is a React SPA that
only talks to `window.omamole` (contextBridge, `sandbox: true`,
`contextIsolation: true`). The shared contract is `src-electron/types.ts`;
the renderer imports it **type-only**.

- `src-electron/main.ts` — window (frameless; Hyprland owns the frame), IPC
  handlers that re-validate every argument, TTL caches shared between the
  overview and detail views (`cached()` in `exec.ts`).
- `src-electron/probes/*` — one module per view. `scan.ts#scoreSystem` is pure
  and is the single source of the score and recommendations.
- `src-electron/safety.ts` — `deletionProblem` / `safeRemove` /
  `clearContents`. **Every user-side deletion goes through it.** Never call
  `fs.rm` directly anywhere else.
- `src-electron/privileged.ts` + `helper/omamole-helper` — root work via
  `pkexec`, batched into one invocation per clean. The helper has a fixed
  action vocabulary and hard-coded paths; it must never accept a path argument.
- `src-electron/terminal.ts` — interactive work (updates, orphans, pacdiff,
  snapshots, unit status) handed to `omarchy-launch-floating-terminal-with-presentation`.
  The renderer names an action id; it never sends a command string.
- `src-electron/theme.ts` — reads the Omarchy palette and emits raw `--om-*`
  role variables; watches `~/.local/state/omarchy/current/` (the directory —
  `omarchy-theme-set` replaces `theme/` wholesale).
- `src/` — `App.tsx` (shell, global keys, dialogs, toasts), `components/List.tsx`
  (the one cursor-list every view uses), `views/*`.

## Invariants

- **No color literal in `src/styles.css` below the first `:root` block.** Every
  color is an Omarchy Design System role or a `color-mix` of one. Status colors
  are always paired with a glyph (several themes map green = yellow = accent).
- **One highlight on screen.** Lists use `List`/`RowDef`; hover writes the
  cursor. Don't add a second hover style.
- **Keys:** views register handlers with `useKeys(handler, app.active)`;
  handlers registered last run first; return `true` to consume. App-level keys
  (`1-8`, `Tab`, `?`, `Ctrl ±`) run before view keys; `h`/`Esc`/`r` are
  fallbacks after them. Don't bind `Tab` or digits in a view.
- **Dev artifacts need their marker.** `ARTIFACT_RULES` in `probes/dev.ts`
  pairs each directory name with a sibling project file; `removeArtifacts`
  re-checks the rule at delete time.
- Commands run with `LC_ALL=C` (`exec.ts#run`) so parsers never see translated
  or comma-decimal output.

## Verifying UI changes

Headless, without touching the user's tiling layout:

```bash
electron43 --ozone-platform=headless --remote-debugging-port=9333 \
  --user-data-dir="$(mktemp -d)" .
```

then drive it over CDP (`Emulation.setDeviceMetricsOverride` for size,
`Input.dispatchKeyEvent` for keys, `Page.captureScreenshot`). CSS animations
don't advance headless — a dialog captured mid-`pop-in` looks translucent.
Check light themes too (catppuccin-latte, flexoki-light): inject their
`--om-*` values on `documentElement`.

Never test cleanup against the real home: run probes with `HOME=<temp dir>`
(`os.homedir()` honours it) as the e2e check did.

## Packaging

`packaging/PKGBUILD` (pkgname `omamole`, repo `mrelph/OmaMole`, so the tarball
directory is `OmaMole-<ver>`), `packaging/omamole.desktop`
(`StartupWMClass=omamole` must match the Wayland app id = package.json `name`),
and a polkit policy scoped to `/usr/lib/omamole/helper/omamole-helper`.
Release flow: bump `version` in package.json and `pkgver`, commit, tag
`v<ver>`, push the tag, then `updpkgsums` in `packaging/` and commit the
checksum (the tagged tree itself still carries the previous checksum — that
is expected; makepkg uses the PKGBUILD you run it from).
