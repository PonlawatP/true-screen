# M0 Pointer-Warp Proof Spike

This spike answers two questions on Fedora 44 GNOME 50 Wayland:

1. Can a GNOME Shell extension observe global pointer motion?
2. Can it move the cursor to another logical monitor through
   `Clutter.Seat.warp_pointer()`?

The extension exposes a session-local debug D-Bus name only for M0:
`io.plutostudio.TrueScreen.Spike`. It must be removed before a production build
because arbitrary processes in the same desktop session could otherwise request
a pointer warp.

## Run

```bash
./scripts/install-extension.sh
./scripts/run-headless-spike.sh
npm test
```

The install script explicitly includes the shared geometry module in the bundle
and installs it for the current user. GNOME 50 cannot discover a brand-new local
UUID in an already-running Wayland shell, so the automated verifier uses
`gnome-shell-test-tool` to start an isolated headless GNOME session. The live
session can enable the extension after the next login.

The automation script runs with two isolated virtual monitors, injects pointer
motion, checks that the extension observed it, asks the extension to warp to the
next monitor, and fails unless the final position matches. The official test
tool uses temporary XDG directories, so it does not modify the main desktop's
extension settings. A small process wrapper adds the second monitor without
depending on Fedora's optional Mutter test library.

## Inspect

```bash
gnome-extensions info true-screen@plutostudio.io
gdbus call --session \
  --dest io.plutostudio.TrueScreen.Spike \
  --object-path /io/plutostudio/TrueScreen/Spike \
  --method io.plutostudio.TrueScreen.Spike.GetState
journalctl --user -b -o cat | grep 'True Screen'
```

## Recovery

If the extension behaves unexpectedly, disable it immediately:

```bash
gnome-extensions disable true-screen@plutostudio.io
```

To remove the developer installation:

```bash
./scripts/uninstall-extension.sh
```

## M0 pass conditions

- Extension state is `ACTIVE` with no shell exception.
- `verify-spike.js` reports `passed: true` on a multi-monitor Wayland session.
- `motionEvents` increases after normal mouse movement.
- Disabling the extension removes the D-Bus name and leaves pointer behavior
  unchanged.
