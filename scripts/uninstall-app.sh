#!/usr/bin/env bash
set -euo pipefail

data_home="${XDG_DATA_HOME:-${HOME}/.local/share}"
install_root="${data_home}/true-screen"
applications_dir="${data_home}/applications"
icons_root="${data_home}/icons/hicolor"
desktop_file="${applications_dir}/io.plutostudio.TrueScreen.desktop"
icon_file="${icons_root}/512x512/apps/io.plutostudio.TrueScreen.png"

rm -f -- "${desktop_file}" "${icon_file}"
if [[ -d "${install_root}" ]]; then
    rm -r -- "${install_root}"
fi

if command -v update-desktop-database >/dev/null 2>&1 && [[ -d "${applications_dir}" ]]; then
    update-desktop-database "${applications_dir}"
fi
if command -v gtk4-update-icon-cache >/dev/null 2>&1 && [[ -d "${icons_root}" ]]; then
    gtk4-update-icon-cache -f -t "${icons_root}" >/dev/null
fi

echo "Uninstalled True Screen. Saved monitor layouts were kept."

