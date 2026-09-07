---
id: feat-desktop-app-launcher
type: feature
status: stable
last_reviewed: 2026-08-28
core_files:
  - data/io.plutostudio.TrueScreen.desktop.in
  - data/true-screen
  - data/icons/io.plutostudio.TrueScreen.png
  - scripts/install-app.sh
  - scripts/uninstall-app.sh
depends_on:
  - "[[feat-monitor-layout-profiles]]"
impacts: []
related_states: []
---

# feat-desktop-app-launcher

## Business Rules

- True Screen can be launched from GNOME's application menu without opening a
  terminal or retaining a checkout at its original path.
- Installation is user-local under `XDG_DATA_HOME` (or `~/.local/share`) and
  never requires root privileges.
- Reinstalling refreshes the application JavaScript, launcher, desktop entry,
  and icon from the current checkout.
- Uninstalling removes only installed application assets. It preserves saved
  monitor layouts and the GNOME Shell extension.
- The desktop entry uses the same application ID as the running Adwaita
  application and does not advertise D-Bus activation.

## Verification

- `desktop-file-validate` on the rendered desktop entry
- `bash -n data/true-screen scripts/install-app.sh scripts/uninstall-app.sh`
- Install, launch from GNOME's application menu, and uninstall

## Change Log

| Date | Change |
|------|--------|
| 2026-08-19 | Created |
| 2026-08-19 | Added the generated application icon, executable launcher, and user-local GNOME install/uninstall workflow; status: stable. |
| 2026-08-24 | Reconciled the completed user-local launcher, application asset refresh, and layout-preserving uninstall workflow; status: stable. |
| 2026-08-28 | Re-verified launcher packaging as a downstream consumer of monitor profiles; extension-side load auto-alignment requires no launcher behavior change; status: stable. |
