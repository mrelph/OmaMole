#!/usr/bin/env bash
# Resolve an Electron binary to run OmaMole during development.
#
# OmaMole targets the system Electron (see packaging/PKGBUILD) rather than a
# bundled copy, so development runs against the same runtime that ships the
# app. Arch names the binary `electron` (meta-package) or `electron<major>`.
set -euo pipefail

for candidate in electron electron43 electron44 electron42 electron41; do
  if command -v "$candidate" > /dev/null 2>&1; then
    exec "$candidate" "$@"
  fi
done

if [ -x node_modules/.bin/electron ]; then
  exec node_modules/.bin/electron "$@"
fi

echo "omamole: no Electron binary found." >&2
echo "Install the system package (Arch: 'sudo pacman -S electron43')." >&2
exit 1
