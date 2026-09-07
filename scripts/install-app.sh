#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
data_home="${XDG_DATA_HOME:-${HOME}/.local/share}"
install_root="${data_home}/true-screen"
applications_dir="${data_home}/applications"
icons_dir="${data_home}/icons/hicolor/512x512/apps"
desktop_file="${applications_dir}/io.plutostudio.TrueScreen.desktop"

install -d -m 755 \
    "${install_root}/app" \
    "${install_root}/bin" \
    "${applications_dir}" \
    "${icons_dir}"
install -m 644 "${project_dir}"/app/*.js "${install_root}/app/"
install -m 755 "${project_dir}/data/true-screen" "${install_root}/bin/true-screen"
install -m 644 \
    "${project_dir}/data/icons/io.plutostudio.TrueScreen.png" \
    "${icons_dir}/io.plutostudio.TrueScreen.png"

escaped_exec="${install_root//&/\\&}/bin/true-screen"
sed "s|@EXEC@|${escaped_exec}|g" \
    "${project_dir}/data/io.plutostudio.TrueScreen.desktop.in" \
    > "${desktop_file}"
chmod 644 "${desktop_file}"
desktop-file-validate "${desktop_file}"

if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "${applications_dir}"
fi
if command -v gtk4-update-icon-cache >/dev/null 2>&1; then
    gtk4-update-icon-cache -f -t "${data_home}/icons/hicolor" >/dev/null
fi

echo "Installed True Screen. Open it from the application menu or run:"
echo "  ${install_root}/bin/true-screen"

