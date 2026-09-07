---
id: feat-monitor-layout-editor
type: feature
status: stable
last_reviewed: 2026-08-28
core_files:
  - app/inspect-monitors.js
  - app/monitor-canvas.js
  - app/monitor-layout-geometry.js
  - app/monitor-transform.js
  - app/ruler-geometry.js
  - extension/true-screen@plutostudio.io/desktop-ruler.js
  - tests/app/ruler-render.js
  - tests/monitor-layout-geometry.test.mjs
depends_on: []
impacts:
  - "[[feat-monitor-layout-profiles]]"
related_states: []
---

# feat-monitor-layout-editor

## Business Rules

- Active monitors are discovered from Mutter and represented in both logical
  desktop coordinates and real-world physical millimetres.
- Users can select, move, and proportionally resize monitor rectangles without
  changing the GNOME display mode itself.
- The canvas ruler provides a detailed selected-pair comparison. The desktop
  ruler covers all connected monitors and every physically adjacent pair.
- Ruler ticks, labels, and monitor ranges render on all four sides of both the
  canvas and each desktop overlay.
- Canvas interactions expose grab, grabbing, and diagonal resize cursors that
  match the action available at the pointer position.
- Detected dimensions respect monitor rotation; manual dimensions remain aligned
  to the current logical orientation.
- Monitor rectangles cannot overlap. Dragging into another monitor holds the
  moving rectangle flush against the entered edge until the user moves around it.
- Restored or newly detected overlap is resolved to the nearest touching edge.
- Collision restoration accepts a candidate only when it is both connected to
  the monitor graph and free of overlap with every existing rectangle; touching
  one neighbor cannot hide an overlap with another neighbor.
- Restoration processes monitors in their current Mutter logical left-to-right
  and top-to-bottom order, rather than unstable enumeration order, so collision
  repair preserves the detected desktop topology.
- Snap alignment activates within 5 mm. Every monitor edge and corner is a
  proportional resize handle; dragging inside the overlay moves the monitor.
- Resizing never stops at another monitor: the growing rectangle translates away
  from the collision while retaining the requested size and non-overlap invariant.
- While the app is open, the desktop ruler renders live draft geometry without
  changing the applied cursor-routing layout. Closing the app removes the ruler.
- Desktop ruler visibility fades in and out over 180 ms. Live draft geometry
  replacements preserve the current opacity so dragging never restarts the fade.
- The complete monitor graph remains connected during move, numeric alignment,
  resize, and restoration; moving a bridge monitor cannot orphan another screen.

## Change Log

| Date | Change |
|------|--------|
| 2026-08-19 | Created |
| 2026-08-19 | Documented the existing layout editor and ruler baseline during Feature Books initialization; status: stable. |
| 2026-08-19 | Prevented monitor overlap during drag, snap, and layout restoration; retained status: stable. |
| 2026-08-19 | Reduced snap alignment to 5 mm and added collision-aware proportional resize from all four corners; retained status: stable. |
| 2026-08-19 | Added live desktop-ruler preview for draft movement and teardown on app close; retained status: stable. |
| 2026-08-19 | Kept the full monitor graph attached during edits and expanded desktop rulers to all monitors and adjacent pairs; retained status: stable. |
| 2026-08-19 | Made monitor overlays draggable from their interior and proportionally resizable from every edge and corner, with matching cursor and handle affordances; retained status: stable. |
| 2026-08-19 | Added action-specific canvas cursors for monitor movement and corner resizing; retained status: stable. |
| 2026-08-19 | Added 180 ms desktop-ruler fade transitions while preserving opacity across live geometry updates; retained status: stable. |
| 2026-08-19 | Mirrored ruler ticks, labels, and ranges onto the bottom and right sides of the canvas and desktop overlays; retained status: stable. |
| 2026-08-24 | Reconciled connected non-overlapping geometry restoration, proportional edge and corner editing, rotation-aware sizing, and ruler rendering with the current implementation; status: stable. |
| 2026-08-28 | Re-verified the editor's existing overlap-resolution contract as a downstream dependency of extension-side load auto-alignment; no editor behavior changed; status: stable. |
| 2026-08-28 | Fixed multi-obstacle restoration so a third monitor touching one neighbor cannot be accepted while still overlapping another, and made repair follow live logical topology instead of enumeration order, with regression coverage from the live three-monitor geometry; status: stable. |
