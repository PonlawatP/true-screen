---
id: feat-monitor-layout-profiles
type: feature
status: stable
last_reviewed: 2026-09-07
core_files:
  - app/layout-profiles.js
  - app/config-store.js
  - app/monitor-service.js
  - app/main.js
  - tests/layout-profiles.test.mjs
  - tests/app/config-roundtrip.js
  - extension/true-screen@plutostudio.io/profile-activation.js
  - tests/profile-activation.test.mjs
  - README.md
depends_on:
  - "[[feat-monitor-layout-editor]]"
impacts:
  - "[[feat-pointer-routing]]"
  - "[[feat-desktop-app-launcher]]"
related_states: []
---

# feat-monitor-layout-profiles

## Business Rules

- `skipScreenGaps` defaults to false and is stored per exact monitor set. Its sidebar switch is sensitive only when cursor remapping is enabled; it uses draft/apply and dirty-exit behavior. Geometry auto-repair and immediate ruler changes preserve the setting.

- A saved layout belongs to one exact, unordered multiset of stable physical
  monitor identities. Vendor, product, and serial define identity; the current
  Mutter connector name does not.
- Adding or removing a monitor selects a different profile; values from a partial
  monitor match must never leak into the new set.
- Monitor enumeration order does not change profile identity.
- The most recently applied profile remains at the schema-version-1 document
  root for compatibility, while both the app and GNOME Shell extension select
  the profile that exactly matches the connected monitor identities.
- Opening or refreshing the app restores valid matching geometry without
  writing the document. An unseen set starts from detected geometry.
- Saving a profile preserves profiles for all other monitor sets and migrates a
  legacy root-only layout into the profile collection.
- If restoring a matching profile requires overlap or connectivity correction,
  the app automatically saves and applies the corrected edge-touching positions;
  the user does not need to press **Apply to desktop** for this repair.
- Automatic correction uses the current Mutter logical topology to determine
  restoration order, keeping left, middle, right and vertical relationships
  stable even when monitor enumeration order differs.
- GNOME Shell activation repairs overlapping saved positions in memory using the
  current Mutter logical placement to choose the separation direction. A valid
  non-overlapping profile remains unchanged, and automatic repair never writes
  the saved profile.
- Ruler visibility and the selected monitor pair take effect immediately while
  preserving the last-applied monitor geometry and cursor-remapping setting.
- Desktop ruler visibility can be toggled whenever monitors are connected and
  does not require a selected monitor or comparison pair.
- Closing the app persists ruler visibility as disabled only when an applied
  profile exists; an unapplied draft must never become a profile during teardown.
- Closing with an unapplied draft keeps the ruler visible while asking the user
  to discard and exit, apply and exit, or cancel and continue editing.

## Edge Cases

- Legacy connector-specific profile keys are matched by stable identity and
  migrate to connector-independent keys the next time a profile is saved.
- Exact connector matches win before connector-independent matching, preserving
  deterministic pairing when multiple otherwise identical monitors are present.
- A monitor set without a saved profile never inherits a partial match from a
  different set.

## Verification

- `npm test`
- `./scripts/test-app.sh` in a GNOME session with Mutter DisplayConfig available

## Change Log

| Date | Change |
|------|--------|
| 2026-08-19 | Created |
| 2026-08-19 | status: active — implementing exact-monitor-set layout persistence and legacy migration. |
| 2026-08-19 | Added exact-set profile selection, automatic activation, legacy root migration, unit coverage, and GJS round-trip coverage; status: stable. |
| 2026-08-19 | Persisted collision-corrected positions when a restored profile contained overlapping monitors; retained status: stable. |
| 2026-08-19 | Updated editor guidance for four-corner resize; retained status: stable. |
| 2026-08-19 | status: active — making desktop ruler visibility update immediately without applying unrelated draft changes. |
| 2026-08-19 | Applied ruler visibility and pair changes immediately while preserving unrelated applied state, added regression coverage, and updated usage guidance; status: stable. |
| 2026-08-19 | Kept live ruler preview ephemeral and disabled persisted ruler visibility on app close without saving draft geometry; retained status: stable. |
| 2026-08-19 | Added guarded dirty-draft exit choices while retaining ruler preview until the user confirms; retained status: stable. |
| 2026-08-19 | Updated editor guidance for draggable monitor-overlay interiors and proportional edge or corner resize; retained status: stable. |
| 2026-08-19 | Decoupled the all-monitor desktop ruler toggle from canvas pair selection; retained status: stable. |
| 2026-08-19 | Documented the user-local GNOME desktop app installer; retained status: stable. |
| 2026-08-24 | Reconciled exact-monitor-set persistence with the current app activation path and documented connector-sensitive identity and root-profile hotplug limitations; status: stable. |
| 2026-08-24 | Made profile identity connector-independent, migrated legacy profile keys, stopped refresh-only geometry writes, and added extension-side exact-set activation with regression coverage; status: stable. |
| 2026-08-28 | Auto-aligned overlapping monitors during extension profile activation from the current Mutter logical direction, without mutating valid layouts or saved profiles; status: stable. |
| 2026-08-28 | Replaced the collision-correction draft prompt with automatic persistence and extension reload when the app restores overlapping or disconnected monitor positions; manual edits remain explicit drafts; status: stable. |
| 2026-08-28 | Routed saved-layout collision repair through current logical monitor order so the live Built-in–Dell–Samsung topology persists without overlap across app restarts; status: stable. |

| 2026-09-07 | Added the Skip screen gaps draft toggle, serialization default, profile persistence coverage, and usage documentation; status: stable. |
