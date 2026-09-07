#!/usr/bin/env bash
set -euo pipefail

uuid='true-screen@plutostudio.io'
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="${project_dir}/extension/${uuid}"
dist_dir="${project_dir}/dist"
bundle="${dist_dir}/${uuid}.shell-extension.zip"
development_bus='io.plutostudio.TrueScreen.Development'
development_path='/io/plutostudio/TrueScreen/Development'
development_interface='io.plutostudio.TrueScreen.Development'
installed_dir="${XDG_DATA_HOME:-${HOME}/.local/share}/gnome-shell/extensions/${uuid}"

mkdir -p "${dist_dir}"
gnome-extensions pack \
    --force \
    --extra-source=edge-router.js \
    --extra-source=desktop-ruler.js \
    --extra-source=implementation.js \
    --extra-source=profile-activation.js \
    --out-dir "${dist_dir}" \
    "${source_dir}"

if gdbus call --session \
    --dest "${development_bus}" \
    --object-path "${development_path}" \
    --method "${development_interface}.GetDevelopmentState" \
    >/dev/null 2>&1; then
    install -d -m 755 "${installed_dir}"
    install -m 644 \
        "${source_dir}/extension.js" \
        "${source_dir}/implementation.js" \
        "${source_dir}/profile-activation.js" \
        "${source_dir}/edge-router.js" \
        "${source_dir}/desktop-ruler.js" \
        "${source_dir}/metadata.json" \
        "${installed_dir}/"
    gdbus call --session \
        --dest "${development_bus}" \
        --object-path "${development_path}" \
        --method "${development_interface}.ReloadImplementation" \
        >/dev/null
    echo "Hot-deployed and reloaded ${uuid}; GNOME Shell was not restarted."
    exit 0
fi

gnome-extensions disable "${uuid}" >/dev/null 2>&1 || true
gnome-extensions install --force "${bundle}"

if gnome-extensions info "${uuid}" >/dev/null 2>&1; then
    gnome-extensions enable "${uuid}"
    installed_version="$(sed -n 's/.*"version":[[:space:]]*\([0-9][0-9]*\).*/\1/p' "${source_dir}/metadata.json")"
    loaded_version="$(gnome-extensions info "${uuid}" | sed -n 's/^[[:space:]]*Version:[[:space:]]*\([0-9][0-9]*\).*/\1/p')"
    if [[ -n "${installed_version}" && -n "${loaded_version}" &&
        "${installed_version}" != "${loaded_version}" ]]; then
        echo "Installed ${uuid} version ${installed_version}, but this Shell session still runs version ${loaded_version}."
        echo "Log out and log back in once to load the updated extension code. Lock/unlock is not enough."
    else
        echo "Installed and enabled ${uuid} version ${installed_version:-unknown}"
    fi
else
    echo "Installed ${uuid}"
    echo "The current Wayland shell has not discovered this new UUID yet."
    echo "Use scripts/run-headless-spike.sh now; the live session can load it after the next login."
fi
