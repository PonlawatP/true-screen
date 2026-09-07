#!/usr/bin/env bash
set -euo pipefail

uuid='true-screen@plutostudio.io'

gnome-extensions disable "${uuid}" >/dev/null 2>&1 || true
gnome-extensions uninstall "${uuid}" >/dev/null 2>&1 || true
echo "Disabled and uninstalled ${uuid}"

