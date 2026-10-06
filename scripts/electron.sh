#!/usr/bin/env bash
# Resolve an Electron binary to run OmaMole during development.
#
# OmaMole targets the system Electron (see packaging/PKGBUILD) rather than a
# bundled copy, so development runs against the same runtime that ships the
# app. Arch names the binary `electron` (meta-package) or `electron<major>`.
set -euo pipefail

# `pnpm start` puts node_modules/.bin first on PATH, and the npm `electron`
# wrapper there silently downloads a bundled Electron. Skip anything that
# resolves inside node_modules so the system runtime always wins.
for candidate in electron43 electron44 electron42 electron41 electron; do
  resolved=$(command -v "$candidate" 2> /dev/null) || continue
  case $resolved in
    */node_modules/*) continue ;;
  esac
  exec "$resolved" "$@"
done

if [ -x node_modules/.bin/electron ]; then
  exec node_modules/.bin/electron "$@"
fi

echo "omamole: no Electron binary found." >&2
echo "Install the system package (Arch: 'sudo pacman -S electron43')." >&2
exit 1
