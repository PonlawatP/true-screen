#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
test_config_dir="$(mktemp -d -t true-screen-app-test-XXXXXXXX)"

cleanup() {
    rm -rf -- "${test_config_dir}"
}
trap cleanup EXIT

XDG_CONFIG_HOME="${test_config_dir}" \
    gjs -m "${project_dir}/tests/app/config-roundtrip.js"

TRUE_SCREEN_RULER_RENDER="${test_config_dir}/ruler-overlay.png" \
    gjs -m "${project_dir}/tests/app/ruler-render.js"
test -s "${test_config_dir}/ruler-overlay.png"
