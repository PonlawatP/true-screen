#!/usr/bin/env bash
set -euo pipefail

# gnome-shell-test-tool supplies the first 1280x720 monitor in headless mode.
# Add a second monitor without depending on the optional libmutter-test package.
exec "$@" --virtual-monitor 1920x1080

