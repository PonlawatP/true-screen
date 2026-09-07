# True Screen

True Screen is a Fedora GNOME utility for arranging monitors by their real-world
physical size and making pointer transitions follow that physical layout.

Phase 1 is now a working developer prototype for Fedora 44, GNOME 50, and
Wayland. The GTK4/Libadwaita app discovers the active monitors, lets you move
and resize their physical rectangles, and writes a layout that the GNOME Shell
extension reloads automatically. The extension then remaps pointer transitions
according to that physical layout.

The canvas also has a **Ruler overlay**. Its detailed comparison follows the
selected pair, while the live desktop overlay covers every connected monitor
and every physically adjacent edge. Each desktop includes an all-monitor
mini-map with the current screen highlighted and green edge bands showing where
cursor correction is mapped. Draft movement is previewed immediately without
changing routing until **Apply to desktop**. The desktop overlay can be toggled
without selecting a monitor; selecting a pair only controls the detailed canvas
comparison.

See [docs/phase-1-plan.md](docs/phase-1-plan.md) for the agreed scope,
architecture, milestones, risks, and acceptance criteria.

## Run it

### Install as a desktop app

Install True Screen for the current user to open it from GNOME's application
menu like a regular program:

```bash
./scripts/install-app.sh
```

Search for **True Screen** in the application menu. Re-run the command after
updating the source to refresh the installed copy. This does not require root
access. To remove the launcher and installed application files while keeping
saved monitor layouts:

```bash
./scripts/uninstall-app.sh
```

### Development setup

Install the development extension first:

```bash
./scripts/install-extension.sh
```

Version 4 installs a stable bootstrap. After that bootstrap has been loaded once,
the same install command hot-deploys and reloads only the True Screen
implementation; it does not restart GNOME Shell or close desktop applications.

The first install of a new extension UUID normally needs one logout/login before
the running GNOME Shell discovers it. After logging back in:

```bash
gnome-extensions enable true-screen@plutostudio.io
./scripts/run-app.sh
```

Monitor geometry, **Remap cursor**, and **Skip screen gaps** edit a draft first, then take effect after
you press **Apply to desktop**. **Ruler overlay** previews the entire draft
immediately. Monitor rectangles remain connected while moving and resizing.
Closing with an unapplied draft asks whether to discard, apply and exit, or
cancel. Later updates are picked up without restarting the app or GNOME Shell.
**Skip screen gaps** is in the right sidebar and requires **Remap cursor**.
Enable it and press **Apply to desktop** to cross empty space to the nearest
screen in the direction of movement, keeping the same physical height (or
horizontal position for vertical movement). For example, the upper part of a
tall left screen can lead directly to a right screen above a shorter middle
screen. Where the middle screen intersects that path, the cursor enters it
normally. With no screen along the path, the edge remains closed. The setting
is off by default and is saved per monitor profile.

Layouts are saved separately for each exact set of connected physical monitor
identities. Connector names are not part of the stable identity, so a display
can move between ports such as `eDP-1` and `eDP-2` without losing its profile.
The GNOME Shell extension restores the matching profile automatically at login,
after monitor hotplug, lock or unlock, display wake, and system resume. An unseen
monitor set fails safe with cursor remapping disabled until it is arranged and
applied in the app. Refreshing the app never writes corrected draft geometry;
press **Apply to desktop** to persist geometry changes.

To stop routing immediately:

```bash
gnome-extensions disable true-screen@plutostudio.io
```

See [docs/prototype-runbook.md](docs/prototype-runbook.md) for the complete test,
recovery, and limitation notes.

## Automated checks

```bash
npm test
./scripts/run-headless-spike.sh
./scripts/test-app.sh
./scripts/test-extension-routing.sh
```

Launch the current GTK prototype with:

```bash
./scripts/run-app.sh
```

See [docs/m0/result-2026-08-10.md](docs/m0/result-2026-08-10.md) for evidence,
known limitations, and the architecture decision.
