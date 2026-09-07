---
id: feat-pointer-routing
type: feature
status: stable
last_reviewed: 2026-09-07
core_files:
  - extension/true-screen@plutostudio.io/edge-router.js
  - extension/true-screen@plutostudio.io/extension.js
  - extension/true-screen@plutostudio.io/implementation.js
  - scripts/inspect-extension-state.js
  - scripts/verify-spike.js
  - scripts/install-extension.sh
  - scripts/run-headless-spike.sh
  - scripts/test-extension-routing.sh
  - tests/edge-router.test.mjs
  - tests/shell/m0-pointer-warp.js
  - tests/shell/physical-routing.js
depends_on:
  - "[[feat-monitor-layout-profiles]]"
impacts: []
related_states: []
---

# feat-pointer-routing

## Business Rules

- Pointer-driven window moves retain mapped crossings, including optional gap
  skipping, so the window follows the warped pointer throughout a held-button
  drag. During moves, unmapped passages use native movement rather than blocking
  barriers, warp-back or post-warp restore guards. Resize and keyboard grabs
  continue to use native movement.
- Grab start cancels old motion/guard warps and invalidates deferred native
  crossings; grab end resumes from the actual pointer without changing saved
  settings. Reloads preserve the grab's routing policy. A compositor-refused
  drag warp disables corrections only until that grab ends, preventing retries
  from trapping the pointer while retaining crossing support for the next drag.
- All pointer corrections temporarily release extension-owned barriers. After
  the compositor settles, a destination-monitor mismatch with the remembered
  request cancels correction state, adopts the actual pointer and backs off
  routing for 250 ms instead of repeatedly warping to an unreachable screen.

- Optional `skipScreenGaps: true` extends routing to the nearest forward screen intersecting the physical pointer ray in all four directions. Nearer screens occlude farther ones; no matching screen means no jump. Barriers, edge pushes, and native-transition fallback share this policy. Missing or false retains adjacent-only routing.

- The GNOME Shell extension selects the schema-version-1 profile matching the
  current stable monitor identities and remaps cursor crossings according to
  physical edge overlap.
- Native logical seams outside a shared physical edge are covered by native
  barriers, proactive event-filter rejection, and transition warp-back. A
  pointer can cross between monitors only along a seam explicitly defined by
  the applied physical layout or an enabled gap-crossing route; completely non-adjacent monitors block the full
  native seam in both directions.
- Integer action geometry overlaps adjacent mapped and blocked segments to
  cover fractional pointer coordinates, then coincident segments are merged
  into one native barrier per seam direction; original half-open ranges decide
  the action and assign partition endpoints and corners to blocking.
- Config replacement is detected and applied without restarting GNOME Shell.
- Routing is fail-safe: missing, invalid, or disabled layout state disables
  correction and removes edge barriers.
- Draft ruler previews use a separate runtime channel and cannot replace the
  applied physical layout used by cursor routing.
- Physical adjacency discovery enumerates every neighbor for all-monitor ruler
  rendering while preserving the same edge mapping contract used by routing.
- Profile activation runs asynchronously inside GNOME Shell and ignores stale
  responses when a newer monitor or lifecycle event supersedes them.
- The matching profile and native barriers are reapplied on extension enable,
  monitor hotplug, session-mode changes, screen-shield activation changes, and
  resume from system sleep. Delayed retries cover staged display wake-up.

## Edge Cases

- Native barrier event IDs may span both blocked and mapped segments. Each hit
  re-evaluates its current coordinate, using the barrier normal for direction
  even when tangential motion dominates a diagonal swipe.
- A new route cancels the previous route's post-warp guard and pending restore,
  including native crossings that do not create a replacement guard. A restore
  of the current guard preserves that guard.

- If Mutter identities and Shell logical monitors are temporarily inconsistent
  during display wake, routing fails safe and a later lifecycle retry rebuilds
  the matching layout.
- If no exact saved monitor set matches, routing and native barriers are disabled
  rather than applying stale or partially matching geometry.
- Saved monitor entries are remapped to current logical indices by physical
  identity, including when Mutter changes enumeration order.
- A matched profile with overlapping physical rectangles is repaired in memory
  from the current logical monitor directions before rulers and routing barriers
  are rebuilt.

## Verification

- `npm test`
- `./scripts/test-extension-routing.sh`
- Live `GetState` reports a matched profile, no barrier error, and all lifecycle
  watchers registered.

## Change Log

| Date | Change |
|------|--------|
| 2026-08-19 | Created |
| 2026-08-19 | Documented the existing GNOME Shell pointer-routing baseline during Feature Books initialization; status: stable. |
| 2026-08-19 | Isolated transient desktop-ruler preview state from applied pointer routing; retained status: stable. |
| 2026-08-19 | Exposed all physical adjacency pairs for complete desktop-ruler rendering; retained status: stable. |
| 2026-08-19 | Made extension disable dispose ruler actors synchronously while ordinary visibility changes retain animated teardown; retained status: stable. |
| 2026-08-19 | Kept shared edges half-open, rejected invalid mapped coordinates, and clamped every warp inside its target monitor to prevent endpoint and drag warps from landing at a screen corner; retained status: stable. |
| 2026-08-19 | Added non-releasing barriers over native seam segments outside a partial physical overlap, preventing cursor leakage while preserving fail-open behavior for completely separated draft layouts; retained status: stable. |
| 2026-08-19 | Resolved overlapping bidirectional barrier hits from the event's actual motion direction and seam side, so the partial edge blocks only its owning source while the reverse full edge remains traversable; retained status: stable. |
| 2026-08-19 | Closed fractional gaps between barrier segments and required an explicit mapped-range match before warping, keeping partition endpoints and diagonal corner hits on the blocked source; retained status: stable. |
| 2026-08-19 | Merged coincident mapped and blocked constraints per seam direction and release the hit event before deferred warp, avoiding Mutter barrier teardown/re-entry races during rapid corner reversals while preserving directional native barriers; retained status: stable. |
| 2026-08-19 | Added short source-inset guards at top-corner endpoints and made the last observed monitor own an ambiguous seam contact, closing the top-corner bypass without invalid negative Mutter coordinates and preventing a blocked pointer's retreat from being misrouted as a reverse scale warp; retained status: stable. |
| 2026-08-20 | Disabled native Meta.Barrier creation after reproducible real-session compositor hangs at the top corner; partial-edge blocking now uses proactive motion rejection plus transition warp-back while physically separated drafts remain fail-open; status: active pending live verification. |
| 2026-08-20 | Moved every motion-triggered pointer warp to an idle queue and stopped consuming global Clutter motion events, preventing hot-corner dispatch re-entry while retaining asynchronous post-warp restoration and directional rejection at partial-edge endpoints; status: active pending live verification. |
| 2026-08-20 | Coalesced high-rate post-warp guard events into at most one restore per 8 ms and cancel pending restores when the guard releases, reducing blocked-edge cursor jitter without weakening rapid-push rejection; status: active pending live verification. |
| 2026-08-20 | Restored v23-style native routing over the middle of each seam while excluding 24 logical pixels at every monitor corner and omitting native corner guards; proactive async routing now handles only excluded corner zones, combining smooth edge confinement with the non-reentrant corner fallback; status: active pending live verification. |
| 2026-08-20 | Reduced the corner exclusion from 24 to 2 logical pixels after live verification showed visible corner leakage; the unsafe native corner guards remain omitted while nearly the entire seam is again covered by the v23-style barrier; status: active pending live verification. |
| 2026-08-20 | Removed the corner exclusion and restored the v23 main barrier through every seam endpoint while continuing to omit the auxiliary top-corner guards associated with compositor hangs; this removes fallback-owned gaps that allowed force-through and unwanted cross-monitor warps; status: active pending live verification. |
| 2026-08-20 | Replaced the unmapped-seam fail-open rule with full bidirectional confinement: native barriers and motion-transition fallback now block every logical seam segment not explicitly shared by the applied physical layout; status: active pending live verification. |
| 2026-08-20 | Added a coalesced asynchronous warp-back at the same edge coordinate for every native block hit, so forbidden seams restore the pointer inside its source monitor instead of relying solely on Mutter retaining the native constraint; status: active pending live verification. |
| 2026-08-20 | Added a persistent blocked-edge ownership guard: diagonal motion may slide along the source edge but cannot change source monitors or enter a mapped passage until the pointer first retreats 12 logical pixels into its owning monitor; status: active pending live verification. |
| 2026-08-20 | Reverted the v31 active block warp-back and v32 persistent ownership guard after live testing showed visible cross-screen warps and prevented valid mapped crossings; forbidden segments again use passive v23-style native confinement, with warp-back reserved for an observed native transition; status: active pending live verification. |
| 2026-08-20 | Restored implementation v31 at the user's request: native block hits again queue a coalesced asynchronous warp-back, while the v32 persistent ownership guard remains removed; status: active pending live verification. |
| 2026-08-24 | Reconciled the current hybrid native-barrier and asynchronous warp routing implementation and documented stale-root profile and index-mapping limitations; status: active. |
| 2026-08-24 | Added asynchronous exact-profile activation and automatic reapplication for boot, hotplug, lock or unlock, display wake, and resume; verified v32 live with all lifecycle watchers and routing barriers active; status: active pending physical lock and resume cycling. |
| 2026-08-28 | Passed Mutter logical geometry into profile activation so overlapping physical monitors auto-align before pointer routing loads; status: active pending physical three-monitor verification. |

| 2026-09-07 | Added optional nearest-screen gap crossing with physical-coordinate preservation, occlusion-aware barriers, and native fallback target guards; unit and headless Shell coverage; status: stable for gap-crossing scope. Physical lock/resume cycling remains a prior manual verification item. |

| 2026-09-07 | Fixed continuous edge sliding and chained crossings: removed blocked-event latching, routed diagonal native hits by barrier normal, and cleared superseded guards/restores. Headless regressions cover a single event sequence moving from blocked to mapped and stale guard replacement; status: stable. |

| 2026-09-07 | Fixed window-drag corner confinement loops: suspend routing during Mutter grabs, cancel deferred crossings, release own barriers for corrections, and verify settled warp destinations with failure recovery. Headless tests cover grab cancellation/resume, reload during grabs and refused-warp loops; status: stable. |

| 2026-09-07 | Restored mapped pointer-driven window dragging, including gap crossings, with native fallback for blocked passages and per-grab refusal recovery. Verified a real GTK window moves forward and backward across a physical gap within one held-button Mutter grab; resize remains native; status: stable. |
