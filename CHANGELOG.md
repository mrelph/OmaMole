# Changelog

## 0.2.0 — 2026-10-06

- **Update notice.** Once a day OmaMole asks GitHub for the newest release
  tag. A newer one shows as a toolbar button and an Overview recommendation;
  `U` builds that release's PKGBUILD and installs it in Omarchy's floating
  terminal, then `U` again restarts into it. Off switch and "check now" in
  Settings. From a source checkout it only tells you to `git pull`.
- **PKGBUILD builds from the git tag** instead of a tarball, so the PKGBUILD
  committed at a tag is complete — no checksum step after tagging.
- `pnpm start` always uses the system Electron, never the npm wrapper's
  downloaded copy.

## 0.1.0 — 2026-10-05

First release. Inspired by WSLMole v2.0.0, rebuilt as a Hyprland-native app for
Arch Linux and Omarchy.

- Eight views: Overview (health score + recommendations + one-key low-risk
  fix), Clean (10 categories with live previews), Disk (folders / files /
  types / old, drill-down), Dev artifacts, Packages (repo + AUR updates,
  orphans, .pacnew, foreign, largest), System (live CPU/memory, failed units,
  filesystems), Omarchy (version, update, Hyprland config errors, monitors,
  plugins, hooks, config backups), Settings.
- Follows the active Omarchy theme, font and Hyprland rounding live; built on
  the Omarchy Design System roles; keyboard-first.
- Root cleanup through a fixed-vocabulary pkexec helper with a polkit policy;
  updates and orphan removal through Omarchy's own commands in its floating
  terminal.
- Arch PKGBUILD on the system electron43.
