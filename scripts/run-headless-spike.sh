#!/usr/bin/env bash
set -euo pipefail

uuid='true-screen@plutostudio.io'
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="${project_dir}/extension/${uuid}"
automation_script="${project_dir}/tests/shell/m0-pointer-warp.js"
shell_wrapper="${project_dir}/scripts/gnome-shell-two-monitors-wrapper.sh"
runtime_dir="$(mktemp -d -t true-screen-test-runtime-XXXXXXXX)"
bundle="${runtime_dir}/${uuid}.shell-extension.zip"
log_dir="${project_dir}/build"
log_file="${log_dir}/m0-headless-shell.log"
result_file="${runtime_dir}/m0-result.json"

cleanup() {
    rm -rf -- "${runtime_dir}"
}
trap cleanup EXIT
chmod 700 "${runtime_dir}"
mkdir -p "${log_dir}"
export TRUE_SCREEN_RESULT_FILE="${result_file}"

gnome-extensions pack \
    --force \
    --extra-source=edge-router.js \
    --extra-source=desktop-ruler.js \
    --extra-source=implementation.js \
    --extra-source=profile-activation.js \
    --out-dir "${runtime_dir}" \
    "${source_dir}"

dbus-run-session -- env XDG_RUNTIME_DIR="${runtime_dir}" \
    gnome-shell-test-tool \
        --headless \
        --disable-animations \
        --wrap "${shell_wrapper}" \
        --extension "${bundle}" \
        "${automation_script}" >"${log_file}" 2>&1

if [[ ! -s "${result_file}" ]]; then
    echo "M0 headless spike failed. Relevant log entries:" >&2
    grep -E 'True Screen|JS ERROR|Script failed|CRITICAL' "${log_file}" >&2 || true
    exit 1
fi

echo "M0 headless spike passed:"
sed -n '1p' "${result_file}"
