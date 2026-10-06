# OmaMole

**Housekeeping for Arch Linux and [Omarchy](https://omarchy.org) — scan, clean, and tune from one keyboard-driven app.**

OmaMole is the Arch/Omarchy member of the Mole family ([WinMole](https://github.com/mrelph/WinMole) for Windows, [WSLMole](https://github.com/mrelph/WSLMole) for WSL). Where WSLMole is a Bash CLI, OmaMole is a native desktop app built for Hyprland: it follows your Omarchy theme and font live, lets the compositor own the window, and drives entirely from the keyboard.

![Electron](https://img.shields.io/badge/Electron%2043-system-47848F?logo=electron&logoColor=white)
![Arch Linux](https://img.shields.io/badge/Arch_Linux-1793D1?logo=archlinux&logoColor=white)
![Hyprland](https://img.shields.io/badge/Hyprland-58E1FF)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

---

## Views

| # | View | What it does |
|---|------|--------------|
| 1 | **Overview** | 0–100 health score and grade, disk / memory / swap meters, and risk-labelled recommendations. `f` applies every low-risk fix in one confirmed batch. |
| 2 | **Clean** | Ten categories with measured sizes and a live preview of exactly what goes: pacman cache (keeps 2 versions, like `omarchy update`), uninstalled-package cache, AUR build cache, systemd journal, crash dumps, thumbnails, browser caches, toolchain caches (npm, pnpm, pip, uv, Go, Cargo, Electron), trash, and the `*.bak.*` files `omarchy refresh` leaves in `~/.config`. |
| 3 | **Disk** | Largest folders (drill in with Enter, back out with `h`), largest files, usage by file type, and files untouched for 180+ days. |
| 4 | **Dev artifacts** | `node_modules`, Rust `target`, virtualenvs, `__pycache__`, `.next`, `dist`/`build` and more — matched only alongside their project file, so a hand-made `build/` folder is never listed. Age filter, multi-select, batch delete. |
| 5 | **Packages** | Pending repo + AUR updates (`checkupdates`, no partial-upgrade risk), orphans, unmerged `.pacnew`/`.pacsave` files, foreign packages, and the largest installed packages. |
| 6 | **System** | Live CPU (sampled, not lifetime averages) and memory top lists, failed systemd units (system and user; Enter opens status + journal), filesystems, load, boot time. |
| 7 | **Omarchy** | Omarchy version, channel and pending update, theme and font, Hyprland version, **config errors**, monitors, shell plugins, active hooks, and config backups to review and trash. |
| 8 | **Settings** | Package versions to keep, journal limit, scan folders, excluded paths. |

## Built for Omarchy

- **Theme-following.** Colours come from `~/.local/state/omarchy/current/theme/colors.toml` and repaint live on `omarchy theme set` — dark and light themes alike. The UI is built from the [Omarchy Design System](https://github.com/mrelph/omarchy-design-system) roles (foreground / background / accent / urgent and alpha-on-foreground fills); there is no colour literal in the stylesheet.
- **Font-following.** Text and icons use your `omarchy font set` monospace Nerd Font. Icons are Nerd Font glyphs, not an icon pack.
- **Compositor-owned window.** No title bar, no drawn border, no shadows; corner radius follows Hyprland's `decoration:rounding`. Works tiled down to ~560 px wide (the nav collapses to glyphs).
- **Keyboard first.** `1`–`8` views, `j`/`k` move, `Enter` act, `Space` select, `Tab` switch between nav and content, `r` refresh, `?` help, `Ctrl +/−` zoom. Mouse hover moves the same cursor — one highlight on screen, ever.
- **Omarchy's own tools for system work.** Updates run `omarchy update`, orphans `omarchy-update-orphan-pkgs`, and snapshots `omarchy snapshot create`, each in Omarchy's floating terminal. OmaMole rescans when you return to it.

## Safety

- **Nothing is deleted without a confirmation that lists it** — categories and sizes, or the exact paths.
- **Root work is a fixed vocabulary.** `pacman` cache, journal and crash-dump cleanup go through `helper/omamole-helper`, launched with `pkexec` (one password prompt per batch, via your polkit agent). It accepts four actions with validated arguments and never takes a path from the app.
- **User-side deletions are guarded.** Every path is checked to be absolute, normalised, inside your home, and outside protected locations (`~/.ssh`, `~/.gnupg`, keyrings, `~/.config/omarchy`, and the top-level home folders themselves). Symlinks are unlinked, never followed. Cache directories are emptied, not removed.
- **Review items go to the trash**, not `rm`: config backups and files from the Disk view.
- **Freed space is measured**, with the same probe before and after, never assumed.

## Install

### Arch package (recommended)

```bash
git clone https://github.com/mrelph/OmaMole.git
cd OmaMole/packaging
makepkg -si
```

The package depends on the system `electron43`, `pacman-contrib` (for `paccache` / `checkupdates`) and `polkit`, and installs a polkit policy so the password prompt says what it is for.

### From source

```bash
pnpm install
pnpm build
pnpm start          # runs on the system electron43
```

### Hyprland

OmaMole's Wayland app id is `omamole`. It tiles by default; to float it like Omarchy's utility windows, add to `~/.config/hypr/windows.lua`:

```lua
o.window({ class = "^(omamole)$" }, { float = true, size = "1200 800", center = true })
```

and bind a key in `~/.config/hypr/bindings.lua`, e.g. `Super + Alt + M` → `omamole`.

## Development

```bash
pnpm dev            # Vite + tsc watch + Electron
pnpm typecheck      # both tsconfigs
pnpm test           # vitest: safety guard, parsers, scoring, theme
```

See [CLAUDE.md](CLAUDE.md) for architecture and invariants.

## License

[MIT](LICENSE)
