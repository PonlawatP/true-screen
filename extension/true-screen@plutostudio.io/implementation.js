import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const moduleSuffix = import.meta.url.includes('?')
    ? import.meta.url.slice(import.meta.url.indexOf('?'))
    : '';
const {
    barrierActionAtCoordinate,
    centerOf,
    clampPointToMonitor,
    edgeBarrierSpecs,
    findMonitor,
    mergedBarrierGeometry,
    nextMonitor,
    rejectNativeTransition,
    routeEdgePush,
    routeTransition,
    trimBarrierGeometryFromCorners,
    warpGuardDecision,
} = await import(`./edge-router.js${moduleSuffix}`);
const {DesktopRulerOverlay} = await import(`./desktop-ruler.js${moduleSuffix}`);
const {
    activateProfile,
    monitorSetKey,
} = await import(`./profile-activation.js${moduleSuffix}`);

export const IMPLEMENTATION_VERSION = 32;

const DBUS_NAME = 'io.plutostudio.TrueScreen.Spike';
const DBUS_PATH = '/io/plutostudio/TrueScreen/Spike';
const DBUS_INTERFACE = 'io.plutostudio.TrueScreen.Spike';
const NATIVE_BARRIER_CORNER_INSET = 0;

const OPPOSITE_DIRECTION = {
    left: 'right',
    right: 'left',
    up: 'down',
    down: 'up',
};

const DBUS_XML = `
<node>
  <interface name="${DBUS_INTERFACE}">
    <method name="GetState">
      <arg type="s" name="state" direction="out"/>
    </method>
    <method name="WarpToNextMonitor">
      <arg type="s" name="result" direction="out"/>
    </method>
    <method name="WarpToPoint">
      <arg type="i" name="x" direction="in"/>
      <arg type="i" name="y" direction="in"/>
      <arg type="s" name="result" direction="out"/>
    </method>
    <method name="SetMotionTrackingEnabled">
      <arg type="b" name="enabled" direction="in"/>
    </method>
    <method name="PreviewRuler">
      <arg type="s" name="layout" direction="in"/>
    </method>
    <method name="ClearRulerPreview"/>
  </interface>
</node>`;

function monitorSnapshot() {
    return Main.layoutManager.monitors.map((monitor, position) => ({
        index: monitor.index ?? position,
        x: monitor.x,
        y: monitor.y,
        width: monitor.width,
        height: monitor.height,
    }));
}

function monitorIdentitiesFromState(result) {
    const logicalMonitors = result[2];
    const snapshots = monitorSnapshot();
    if (logicalMonitors.length !== snapshots.length) {
        throw new Error(
            `Mutter identity count ${logicalMonitors.length} does not match ` +
            `Shell monitor count ${snapshots.length}`,
        );
    }

    const usedSnapshots = new Set();
    return logicalMonitors.map((logical, position) => {
        const spec = logical[5]?.[0];
        if (!Array.isArray(spec) || spec.length < 4)
            throw new Error(`Mutter monitor ${position} has no stable identity`);
        const snapshot = snapshots.find(monitor =>
            !usedSnapshots.has(monitor) &&
            monitor.x === logical[0] && monitor.y === logical[1],
        );
        if (!snapshot) {
            throw new Error(
                `Mutter monitor ${position} has no matching Shell geometry`,
            );
        }
        usedSnapshots.add(snapshot);
        return {
            index: snapshot.index,
            id: spec.join('|'),
            connector: spec[0],
            x: snapshot.x,
            y: snapshot.y,
            width: snapshot.width,
            height: snapshot.height,
        };
    });
}

export default class TrueScreenImplementation {
    enable() {
        this._enabled = true;
        this._motionTrackingEnabled = true;
        this._motionEvents = 0;
        this._monitorTransitions = 0;
        this._routeAttempts = 0;
        this._warps = 0;
        this._nativePasses = 0;
        this._edgePushes = 0;
        this._rejectedTransitions = 0;
        this._postWarpGuardEvents = 0;
        this._postWarpRestores = 0;
        this._barrierHits = 0;
        this._blockedEdgeHits = 0;
        this._lastRoute = null;
        this._routeHistory = [];
        this._routeSerial = 0;
        this._lastMonitorIndex = null;
        this._lastMotion = null;
        this._lastRelativeMotionProbe = null;
        this._ignoreMotionUntil = 0;
        this._warpGuard = null;
        this._pendingMotionWarp = null;
        this._pendingMotionWarpSourceId = 0;
        this._pendingGuardRestore = null;
        this._pendingGuardRestoreSourceId = 0;
        this._lastGuardRestoreAt = 0;
        this._edgeBarriers = [];
        this._edgeBarrierActions = [];
        this._edgeBarrierError = null;
        this._barriersSuspended = false;
        this._barrierWarpPending = null;
        this._layout = null;
        this._layoutDocument = null;
        this._activeMonitorSetKey = null;
        this._lastLayoutSyncReason = null;
        this._lastLayoutSyncStatus = 'starting';
        this._layoutSyncSerial = 0;
        this._layoutSyncSourceIds = new Set();
        this._monitorsChangedId = 0;
        this._sessionModeUpdatedId = 0;
        this._screenShieldChangedId = 0;
        this._prepareForSleepId = 0;
        this._rulerPreview = null;
        this._seat = Clutter.get_default_backend().get_default_seat();
        this._desktopRulers = new DesktopRulerOverlay();

        this._configFile = Gio.File.new_for_path(GLib.build_filenamev([
            GLib.get_user_config_dir(),
            'true-screen',
            'layout.json',
        ]));
        this._configDir = this._configFile.get_parent();
        try {
            this._configDir.make_directory_with_parents(null);
        } catch (error) {
            if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
                console.warn(`[True Screen] Could not create config directory: ${error.message}`);
        }
        this._watchLayout();
        this._watchDesktopLifecycle();
        this._loadLayout('enable');

        this._eventFilterId = Clutter.Event.add_filter(
            global.stage,
            this._onEvent.bind(this),
        );

        this._busOwnerId = Gio.bus_own_name(
            Gio.BusType.SESSION,
            DBUS_NAME,
            Gio.BusNameOwnerFlags.NONE,
            connection => this._exportDebugInterface(connection),
            null,
            () => console.warn(`[True Screen] Could not own ${DBUS_NAME}`),
        );

        console.log('[True Screen] M0 spike enabled');
    }

    disable() {
        this._enabled = false;

        if (this._eventFilterId) {
            Clutter.Event.remove_filter(this._eventFilterId);
            this._eventFilterId = 0;
        }

        this._dbusObject?.unexport();
        this._dbusObject = null;

        if (this._configChangedId) {
            this._configMonitor?.disconnect(this._configChangedId);
            this._configChangedId = 0;
        }
        this._configMonitor?.cancel();
        this._configMonitor = null;
        this._unwatchDesktopLifecycle();
        this._configFile = null;
        this._configDir = null;
        this._layout = null;
        this._layoutDocument = null;
        this._rulerPreview = null;
        this._cancelGuardRestore();
        this._destroyEdgeBarriers();
        this._desktopRulers?.dispose();
        this._desktopRulers = null;

        if (this._busOwnerId) {
            Gio.bus_unown_name(this._busOwnerId);
            this._busOwnerId = 0;
        }

        this._seat = null;
        this._pendingMotionWarp = null;
        this._lastMotion = null;
        console.log('[True Screen] M0 spike disabled');
    }

    GetState() {
        const [pointerX, pointerY] = global.get_pointer();
        return JSON.stringify({
            extensionEnabled: this._enabled,
            motionTrackingEnabled: this._motionTrackingEnabled,
            motionEvents: this._motionEvents,
            monitorTransitions: this._monitorTransitions,
            routeAttempts: this._routeAttempts,
            warps: this._warps,
            nativePasses: this._nativePasses,
            edgePushes: this._edgePushes,
            rejectedTransitions: this._rejectedTransitions,
            postWarpGuardEvents: this._postWarpGuardEvents,
            postWarpRestores: this._postWarpRestores,
            barrierHits: this._barrierHits,
            blockedEdgeHits: this._blockedEdgeHits,
            lastRoute: this._lastRoute,
            routeHistory: this._routeHistory,
            pointer: {x: pointerX, y: pointerY},
            monitors: monitorSnapshot(),
            lastMotion: this._lastMotion,
            lastRelativeMotionProbe: this._lastRelativeMotionProbe,
            layoutLoaded: this._layout !== null,
            routingEnabled: this._layout?.enabled === true,
            skipScreenGaps: this._layout?.skipScreenGaps === true,
            activeMonitorSetKey: this._activeMonitorSetKey,
            lastLayoutSyncReason: this._lastLayoutSyncReason,
            lastLayoutSyncStatus: this._lastLayoutSyncStatus,
            lifecycleWatchers: {
                monitorsChanged: this._monitorsChangedId !== 0,
                sessionMode: this._sessionModeUpdatedId !== 0,
                screenShield: this._screenShieldChangedId !== 0,
                prepareForSleep: this._prepareForSleepId !== 0,
            },
            pendingLayoutSyncs: this._layoutSyncSourceIds.size,
            warpGuard: this._warpGuard,
            edgeBarrierCount: this._edgeBarriers.length,
            edgeBarrierActionCount: this._edgeBarrierActions.length,
            edgeBarrierError: this._edgeBarrierError,
            barriersSuspended: this._barriersSuspended,
            barrierWarpPending: this._barrierWarpPending !== null,
            pendingMotionWarp: this._pendingMotionWarp !== null ||
                this._pendingGuardRestore !== null,
            nativeBarrierCornerInset: NATIVE_BARRIER_CORNER_INSET,
            desktopRulerActors: this._desktopRulers?.actorCount ?? 0,
            rulerPreviewActive: this._rulerPreview !== null,
        });
    }

    WarpToNextMonitor() {
        const monitors = monitorSnapshot();
        if (monitors.length < 2)
            throw new Error('The pointer-warp spike requires at least two monitors');

        const [pointerX, pointerY] = global.get_pointer();
        const current = findMonitor(monitors, pointerX, pointerY) ?? monitors[0];
        const target = nextMonitor(monitors, current.index);
        const destination = centerOf(target);
        const targetX = Math.round(destination.x);
        const targetY = Math.round(destination.y);

        this._seat.warp_pointer(targetX, targetY);
        console.log(
            `[True Screen] Warped pointer from monitor ${current.index} ` +
            `to ${target.index} at ${targetX},${targetY}`,
        );

        return JSON.stringify({
            sourceIndex: current.index,
            targetIndex: target.index,
            before: {x: pointerX, y: pointerY},
            destination: {x: targetX, y: targetY},
        });
    }

    WarpToPoint(x, y) {
        const monitors = monitorSnapshot();
        const target = findMonitor(monitors, x, y);
        if (!target)
            throw new Error(`Point ${x},${y} is outside the logical monitor layout`);

        const [pointerX, pointerY] = global.get_pointer();
        this._seat.warp_pointer(x, y);
        console.log(`[True Screen] Warped pointer to ${x},${y}`);

        return JSON.stringify({
            targetIndex: target.index,
            before: {x: pointerX, y: pointerY},
            destination: {x, y},
        });
    }

    SetMotionTrackingEnabled(enabled) {
        this._motionTrackingEnabled = enabled;
    }

    PreviewRuler(layoutJson) {
        const layout = JSON.parse(layoutJson);
        if (layout?.schemaVersion !== 1 || !Array.isArray(layout.monitors) ||
            layout.rulerOverlay?.enabled !== true)
            throw new Error('Invalid desktop ruler preview');
        this._rulerPreview = layout;
        this._desktopRulers?.update(monitorSnapshot(), layout);
    }

    ClearRulerPreview() {
        this._rulerPreview = null;
        this._desktopRulers?.destroy();
    }

    _exportDebugInterface(connection) {
        if (!this._enabled)
            return;

        this._dbusObject = Gio.DBusExportedObject.wrapJSObject(DBUS_XML, this);
        this._dbusObject.export(connection, DBUS_PATH);
        console.log(`[True Screen] M0 debug interface exported as ${DBUS_NAME}`);
    }

    _deactivateLayout(reason, status, message = null) {
        this._layout = null;
        this._activeMonitorSetKey = null;
        this._lastLayoutSyncReason = reason;
        this._lastLayoutSyncStatus = status;
        this._desktopRulers?.destroy();
        this._destroyEdgeBarriers();
        if (message)
            console.warn(`[True Screen] ${message}`);
    }

    _loadLayout(reason = 'manual') {
        try {
            const [ok, contents] = this._configFile.load_contents(null);
            if (!ok) {
                this._layoutSyncSerial++;
                this._deactivateLayout(reason, 'missing');
                return;
            }
            const document = JSON.parse(new TextDecoder().decode(contents));
            if (document.schemaVersion !== 1 || !Array.isArray(document.monitors))
                throw new Error('Unsupported layout schema');
            this._layoutDocument = document;
            this._lastLayoutSyncReason = reason;
            this._lastLayoutSyncStatus = 'pending';
            const syncSerial = ++this._layoutSyncSerial;
            Gio.DBus.session.call(
                'org.gnome.Mutter.DisplayConfig',
                '/org/gnome/Mutter/DisplayConfig',
                'org.gnome.Mutter.DisplayConfig',
                'GetCurrentState',
                null,
                null,
                Gio.DBusCallFlags.NONE,
                5000,
                null,
                (connection, result) => {
                    if (!this._enabled || syncSerial !== this._layoutSyncSerial)
                        return;
                    try {
                        const state = connection.call_finish(result).recursiveUnpack();
                        const identities = monitorIdentitiesFromState(state);
                        const layout = activateProfile(document, identities);
                        if (!layout) {
                            this._deactivateLayout(
                                reason,
                                'unmatched',
                                `No saved profile matches ${identities.length} active monitors; ` +
                                'routing disabled until a matching profile is applied',
                            );
                            return;
                        }
                        if (reason !== 'config' && reason !== 'manual')
                            this._rulerPreview = null;
                        this._layout = layout;
                        this._activeMonitorSetKey = monitorSetKey(identities);
                        this._lastLayoutSyncReason = reason;
                        this._lastLayoutSyncStatus = 'matched';
                        this._desktopRulers?.update(
                            monitorSnapshot(),
                            this._rulerPreview ?? layout,
                        );
                        this._rebuildEdgeBarriers(monitorSnapshot(), layout);
                        console.log(
                            `[True Screen] Loaded physical layout for ` +
                            `${layout.monitors.length} monitors; ` +
                            `enabled=${layout.enabled === true}; reason=${reason}`,
                        );
                    } catch (error) {
                        this._deactivateLayout(
                            reason,
                            'error',
                            `Layout sync failed; routing disabled: ${error.message}`,
                        );
                    }
                },
            );
        } catch (error) {
            this._layoutSyncSerial++;
            if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) {
                this._deactivateLayout(reason, 'missing');
                return;
            }
            this._deactivateLayout(
                reason,
                'error',
                `Layout sync failed; routing disabled: ${error.message}`,
            );
        }
    }

    _scheduleLayoutSync(reason, delay = 100) {
        if (!this._enabled)
            return;
        let sourceId = 0;
        sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._layoutSyncSourceIds.delete(sourceId);
            if (this._enabled)
                this._loadLayout(reason);
            return GLib.SOURCE_REMOVE;
        });
        this._layoutSyncSourceIds.add(sourceId);
    }

    _scheduleLifecycleSync(reason, delays = [100, 750]) {
        for (const delay of delays)
            this._scheduleLayoutSync(reason, delay);
    }

    _watchDesktopLifecycle() {
        this._monitorsChangedId = Main.layoutManager.connect(
            'monitors-changed',
            () => this._scheduleLifecycleSync('monitors-changed', [100, 750, 2000]),
        );
        this._sessionModeUpdatedId = Main.sessionMode.connect(
            'updated',
            () => this._scheduleLifecycleSync('session-mode'),
        );
        try {
            this._screenShieldChangedId = Main.screenShield.connect(
                'active-changed',
                () => this._scheduleLifecycleSync('screen-shield', [100, 1000]),
            );
        } catch (error) {
            console.debug(`[True Screen] Screen shield lifecycle unavailable: ${error.message}`);
        }
        try {
            this._prepareForSleepId = Gio.DBus.system.signal_subscribe(
                'org.freedesktop.login1',
                'org.freedesktop.login1.Manager',
                'PrepareForSleep',
                '/org/freedesktop/login1',
                null,
                Gio.DBusSignalFlags.NONE,
                (_connection, _sender, _path, _interface, _signal, parameters) => {
                    const [sleeping] = parameters.deepUnpack();
                    if (!sleeping) {
                        this._scheduleLifecycleSync(
                            'resume',
                            [200, 1000, 3000],
                        );
                    }
                },
            );
        } catch (error) {
            console.debug(`[True Screen] Sleep lifecycle unavailable: ${error.message}`);
        }
    }

    _unwatchDesktopLifecycle() {
        for (const sourceId of this._layoutSyncSourceIds ?? [])
            GLib.source_remove(sourceId);
        this._layoutSyncSourceIds?.clear();
        if (this._monitorsChangedId)
            Main.layoutManager.disconnect(this._monitorsChangedId);
        if (this._sessionModeUpdatedId)
            Main.sessionMode.disconnect(this._sessionModeUpdatedId);
        if (this._screenShieldChangedId)
            Main.screenShield.disconnect(this._screenShieldChangedId);
        if (this._prepareForSleepId)
            Gio.DBus.system.signal_unsubscribe(this._prepareForSleepId);
        this._monitorsChangedId = 0;
        this._sessionModeUpdatedId = 0;
        this._screenShieldChangedId = 0;
        this._prepareForSleepId = 0;
    }

    _destroyEdgeBarriers() {
        for (const entry of this._edgeBarriers ?? []) {
            if (entry.hitId)
                entry.barrier.disconnect(entry.hitId);
            entry.barrier.destroy();
        }
        this._edgeBarriers = [];
        this._edgeBarrierActions = [];
        this._barriersSuspended = false;
    }

    _rebuildEdgeBarriers(monitors, layout) {
        this._destroyEdgeBarriers();
        this._edgeBarrierActions = [];
        this._edgeBarrierError = null;
        this._barriersSuspended = false;
        if (layout?.enabled !== true)
            return;

        try {
            this._edgeBarrierActions = edgeBarrierSpecs({
                logicalMonitors: monitors,
                physicalLayout: layout.monitors,
                skipScreenGaps: layout.skipScreenGaps === true,
            });
            const geometry = trimBarrierGeometryFromCorners(
                mergedBarrierGeometry(this._edgeBarrierActions),
                monitors,
                NATIVE_BARRIER_CORNER_INSET,
            );
            // Use the v23 main barrier across the complete seam, including
            // its endpoints. Do not add topCornerBarrierGeometry(): those
            // auxiliary offset guards were the only extra constraints at the
            // compositor-hanging corner. The global filter remains a fallback
            // only if Mutter misses a main-barrier endpoint.
            for (const spec of geometry)
                this._createEdgeBarrier(spec);
        } catch (error) {
            this._edgeBarrierError = error.message;
            this._destroyEdgeBarriers();
            console.warn(`[True Screen] Edge barriers unavailable: ${error.message}`);
        }
    }

    _createEdgeBarrier(spec) {
        const directions = {
            left: Meta.BarrierDirection.NEGATIVE_X,
            right: Meta.BarrierDirection.POSITIVE_X,
            up: Meta.BarrierDirection.NEGATIVE_Y,
            down: Meta.BarrierDirection.POSITIVE_Y,
        }[spec.direction];
        const barrier = new Meta.Barrier({
            backend: global.backend,
            x1: Math.round(spec.x1),
            y1: Math.round(spec.y1),
            x2: Math.round(spec.x2),
            y2: Math.round(spec.y2),
            directions,
            flags: Meta.BarrierFlags.NONE,
        });
        const entry = {barrier, spec, hitId: 0};
        entry.hitId = barrier.connect('hit', (_barrier, event) => {
            this._onBarrierHit(entry, event);
        });
        this._edgeBarriers.push(entry);
        return entry;
    }

    _nativeBarrierCovers(monitor, direction, coordinate) {
        const vertical = direction === 'left' || direction === 'right';
        const fixed = direction === 'left'
            ? monitor.x
            : direction === 'right'
                ? monitor.x + monitor.width
                : direction === 'up'
                    ? monitor.y
                    : monitor.y + monitor.height;
        const orthogonal = vertical ? coordinate.y : coordinate.x;
        return this._edgeBarriers.some(({spec}) => {
            if (spec.direction !== direction || spec.vertical !== vertical)
                return false;
            const barrierFixed = vertical ? spec.x1 : spec.y1;
            const start = vertical ? spec.y1 : spec.x1;
            const end = vertical ? spec.y2 : spec.x2;
            return Math.abs(barrierFixed - fixed) <= 0.001 &&
                orthogonal >= start && orthogonal <= end;
        });
    }

    _suspendEdgeBarriers() {
        this._destroyEdgeBarriers();
        this._barriersSuspended = true;
    }

    _resumeEdgeBarriers() {
        if (!this._barriersSuspended)
            return;
        this._rebuildEdgeBarriers(monitorSnapshot(), this._layout);
    }

    _releaseBarrierEvent(barrier, event) {
        // Shell integration tests call the routing decision with a plain
        // event-shaped object; Mutter only accepts its native boxed event in
        // Meta.Barrier.release(). Real hit signals always provide event_id.
        if (event.event_id !== undefined)
            barrier.release(event);
    }

    _onBarrierHit(entry, event) {
        if (!this._enabled || this._layout?.enabled !== true)
            return;

        if (this._barrierWarpPending !== null) {
            this._releaseBarrierEvent(entry.barrier, event);
            return;
        }

        const monitors = monitorSnapshot();
        const {spec, barrier} = entry;
        const vertical = spec.vertical;
        const normalDelta = vertical ? event.dx : event.dy;
        let direction = null;
        if (vertical && normalDelta < 0)
            direction = 'left';
        else if (vertical && normalDelta > 0)
            direction = 'right';
        else if (!vertical && normalDelta < 0)
            direction = 'up';
        else if (!vertical && normalDelta > 0)
            direction = 'down';

        if (!direction) {
            this._releaseBarrierEvent(barrier, event);
            return;
        }

        const sourceProbe = {x: event.x, y: event.y};
        if (direction === 'left')
            sourceProbe.x += 0.5;
        else if (direction === 'right')
            sourceProbe.x -= 0.5;
        else if (direction === 'up')
            sourceProbe.y += 0.5;
        else
            sourceProbe.y -= 0.5;
        const source = findMonitor(monitors, sourceProbe.x, sourceProbe.y);
        if (!source) {
            this._releaseBarrierEvent(barrier, event);
            return;
        }
        // The seam-side probe is ambiguous after a blocked hit: moving back
        // into the display can wake the opposite directional barrier even
        // though the pointer never crossed. The last observed monitor owns
        // that contact. Releasing the opposite hit avoids a false reverse
        // route and the large scale-derived Y warp it would produce.
        if (this._lastMotion?.monitorIndex !== null &&
            this._lastMotion?.monitorIndex !== undefined &&
            this._lastMotion.monitorIndex !== source.index) {
            this._releaseBarrierEvent(barrier, event);
            return;
        }
        const targetProbe = {x: event.x, y: event.y};
        if (direction === 'left')
            targetProbe.x -= 0.5;
        else if (direction === 'right')
            targetProbe.x += 0.5;
        else if (direction === 'up')
            targetProbe.y -= 0.5;
        else
            targetProbe.y += 0.5;
        const nativeTarget = findMonitor(
            monitors,
            targetProbe.x,
            targetProbe.y,
        );

        // Mutter reuses an event sequence while the pointer slides along a
        // barrier. Re-evaluate its current coordinate on every hit; a blocked
        // segment must not latch the sequence after it reaches a mapped one.
        const orthogonalCoordinate = vertical ? event.y : event.x;
        const barrierAction = barrierActionAtCoordinate(
            this._edgeBarrierActions,
            {
                sourceIndex: source.index,
                direction,
                coordinate: orthogonalCoordinate,
            },
        );
        if (!barrierAction) {
            this._releaseBarrierEvent(barrier, event);
            return;
        }

        const blockPointer = () => {
            this._routeAttempts++;
            this._barrierHits++;
            this._blockedEdgeHits++;
            const routeRecord = this._recordRoute({
                action: 'block',
                reason: 'outside-shared-edge',
                sourceIndex: source.index,
                targetIndex: nativeTarget?.index ?? barrierAction.targetIndex,
                direction,
                mode: 'barrier-block',
                delta: {x: event.dx, y: event.dy, source: 'meta-barrier'},
                sourceCoordinate: {x: event.x, y: event.y},
            });
            const rejection = rejectNativeTransition({
                logicalMonitors: monitors,
                sourceIndex: source.index,
                targetIndex: nativeTarget?.index ?? barrierAction.targetIndex,
                sourceCoordinate: {x: event.x, y: event.y},
            });
            if (rejection.action === 'warp-back') {
                this._warps++;
                this._rejectedTransitions++;
                routeRecord.returnPoint = {x: rejection.x, y: rejection.y};
                this._queueMotionWarp(
                    rejection.x,
                    rejection.y,
                    rejection.targetIndex,
                    routeRecord,
                    false,
                );
            }
        };
        if (barrierAction.action === 'block') {
            blockPointer();
            return;
        }

        const crossingInset = Math.max(2, Math.min(32, Math.abs(normalDelta)));
        const route = routeEdgePush({
            logicalMonitors: monitors,
            physicalLayout: this._layout.monitors,
            skipScreenGaps: this._layout.skipScreenGaps === true,
            sourceIndex: source.index,
            sourceCoordinate: {x: event.x, y: event.y},
            // The barrier identifies the crossed axis. Tangential motion can
            // dominate a diagonal swipe without changing which edge was hit.
            delta: vertical ? {x: normalDelta, y: 0} : {x: 0, y: normalDelta},
            edgeThreshold: 12,
            inset: crossingInset,
        });
        if (route.action !== 'warp') {
            blockPointer();
            return;
        }

        this._routeAttempts++;
        this._warps++;
        this._edgePushes++;
        this._barrierHits++;
        const routeRecord = this._recordRoute({
            ...route,
            sourceIndex: source.index,
            mode: 'barrier',
            crossingInset,
            delta: {x: event.dx, y: event.dy, source: 'meta-barrier'},
            sourceCoordinate: {x: event.x, y: event.y},
        });
        this._barrierWarpPending = routeRecord.serial;
        // Release this native event sequence before warping. Destroying a
        // Meta.Barrier from inside its own `hit` callback can leave Mutter's
        // pointer constraint state inconsistent, especially at a corner or
        // when the user immediately reverses direction.
        this._releaseBarrierEvent(barrier, event);
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            if (!this._enabled)
                return GLib.SOURCE_REMOVE;
            this._suspendEdgeBarriers();
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                if (this._enabled) {
                    this._warpAndRemember(
                        route.x,
                        route.y,
                        route.targetIndex,
                        routeRecord,
                        false,
                    );
                }
                this._barrierWarpPending = 'cooldown';
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 12, () => {
                    this._barrierWarpPending = null;
                    if (this._enabled)
                        this._resumeEdgeBarriers();
                    return GLib.SOURCE_REMOVE;
                });
                return GLib.SOURCE_REMOVE;
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    _watchLayout() {
        try {
            this._configMonitor = this._configFile.monitor_file(
                Gio.FileMonitorFlags.NONE,
                null,
            );
            this._configChangedId = this._configMonitor.connect(
                'changed',
                (_monitor, _file, _otherFile, eventType) => {
                    if (eventType !== Gio.FileMonitorEvent.CHANGES_DONE_HINT &&
                        eventType !== Gio.FileMonitorEvent.CREATED &&
                        eventType !== Gio.FileMonitorEvent.MOVED_IN)
                        return;
                    this._scheduleLayoutSync('config', 50);
                },
            );
        } catch (error) {
            console.warn(`[True Screen] Layout file monitor unavailable: ${error.message}`);
        }
    }

    _recordRoute(route) {
        const entry = {
            serial: ++this._routeSerial,
            at: GLib.get_real_time(),
            ...route,
        };
        this._lastRoute = entry;
        this._routeHistory.push(entry);
        if (this._routeHistory.length > 30)
            this._routeHistory.shift();
        return entry;
    }

    _warpAndRemember(
        x,
        y,
        monitorIndex,
        routeRecord = null,
        createGuard = true,
    ) {
        const target = monitorSnapshot().find(
            monitor => monitor.index === monitorIndex,
        );
        const targetPoint = clampPointToMonitor(target, x, y);
        if (!targetPoint) {
            console.warn(
                `[True Screen] Refusing invalid pointer warp to ${x},${y} ` +
                `on monitor ${monitorIndex}`,
            );
            if (routeRecord)
                routeRecord.warpRefused = 'invalid-destination';
            return false;
        }

        // A new route supersedes any previous screen's guard, even when
        // native barrier routing does not need a new one. Guard restores
        // themselves pass no route record and must keep their active guard.
        if (routeRecord) {
            this._cancelGuardRestore();
            this._warpGuard = null;
        }

        const {x: targetX, y: targetY} = targetPoint;
        const now = GLib.get_monotonic_time();
        // A pointer warp emits another motion event. Ignore routing briefly so
        // that event cannot recursively warp while Clutter is dispatching it.
        this._ignoreMotionUntil = now + 8_000;
        this._seat.warp_pointer(targetX, targetY);
        this._lastMonitorIndex = monitorIndex;
        this._lastMotion = {x: targetX, y: targetY, monitorIndex};
        const guardDirection = routeRecord?.guardDirection ??
            routeRecord?.direction;
        if (createGuard && guardDirection) {
            this._cancelGuardRestore();
            this._warpGuard = {
                sourceIndex: routeRecord.sourceIndex,
                targetIndex: monitorIndex,
                direction: guardDirection,
                x: targetX,
                y: targetY,
                expiresAt: now + 250_000,
            };
        }
        if (routeRecord) {
            routeRecord.requestedPointer = {x: targetX, y: targetY, monitorIndex};
            for (const delay of [25, 80]) {
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                    if (!this._enabled)
                        return GLib.SOURCE_REMOVE;
                    const [pointerX, pointerY] = global.get_pointer();
                    routeRecord[`after${delay}ms`] = {
                        x: pointerX,
                        y: pointerY,
                        monitorIndex: findMonitor(
                            monitorSnapshot(),
                            pointerX,
                            pointerY,
                        )?.index ?? null,
                    };
                    return GLib.SOURCE_REMOVE;
                });
            }
        }
        return true;
    }

    _cancelGuardRestore() {
        if (this._pendingGuardRestoreSourceId) {
            GLib.Source.remove(this._pendingGuardRestoreSourceId);
            this._pendingGuardRestoreSourceId = 0;
        }
        this._pendingGuardRestore = null;
    }

    _queueGuardRestore(guard) {
        this._pendingGuardRestore = {...guard};
        if (this._pendingGuardRestoreSourceId)
            return;

        const elapsed = GLib.get_monotonic_time() - this._lastGuardRestoreAt;
        const delay = Math.max(0, Math.ceil((8_000 - elapsed) / 1_000));
        const restore = () => {
            this._pendingGuardRestoreSourceId = 0;
            const pending = this._pendingGuardRestore;
            this._pendingGuardRestore = null;
            if (this._enabled && pending) {
                this._postWarpRestores++;
                this._lastGuardRestoreAt = GLib.get_monotonic_time();
                this._warpAndRemember(
                    pending.x,
                    pending.y,
                    pending.targetIndex,
                    null,
                    false,
                );
            }
            return GLib.SOURCE_REMOVE;
        };

        this._pendingGuardRestoreSourceId = delay > 0
            ? GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, restore)
            : GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, restore);
    }

    _queueMotionWarp(
        x,
        y,
        monitorIndex,
        routeRecord = null,
        createGuard = true,
    ) {
        if (!this._enabled)
            return false;

        this._pendingMotionWarp = {
            x,
            y,
            monitorIndex,
            routeRecord,
            createGuard,
        };
        if (this._pendingMotionWarpSourceId)
            return true;

        // Never warp from inside the global Clutter event filter. In
        // particular, swallowing and warping a hot-corner motion can re-enter
        // GNOME Shell with an actor from the previous dispatch and wedge the
        // compositor. Idle execution runs after that dispatch has completed.
        this._pendingMotionWarpSourceId = GLib.idle_add(
            GLib.PRIORITY_DEFAULT_IDLE,
            () => {
                this._pendingMotionWarpSourceId = 0;
                const pending = this._pendingMotionWarp;
                this._pendingMotionWarp = null;
                if (this._enabled && pending) {
                    this._warpAndRemember(
                        pending.x,
                        pending.y,
                        pending.monitorIndex,
                        pending.routeRecord,
                        pending.createGuard,
                    );
                }
                return GLib.SOURCE_REMOVE;
            },
        );
        return true;
    }

    _relativeDelta(_event, previous, x, y) {
        this._lastRelativeMotionProbe ??= {
            shape: 'unsupported',
            value: 'Mutter 18 Clutter typelib requires native pointer arguments',
        };
        return {
            x: x - previous.x,
            y: y - previous.y,
            source: 'coordinate-delta',
        };
    }

    _onEvent(event, _eventActor) {
        if (!this._motionTrackingEnabled || event.type() !== Clutter.EventType.MOTION)
            return Clutter.EVENT_PROPAGATE;

        const [x, y] = event.get_coords();
        const monitors = monitorSnapshot();
        const monitor = findMonitor(monitors, x, y);
        const now = GLib.get_monotonic_time();

        this._motionEvents++;
        if (this._barrierWarpPending !== null)
            return Clutter.EVENT_PROPAGATE;

        if (this._warpGuard) {
            const guard = this._warpGuard;
            const decision = warpGuardDecision({
                logicalMonitors: monitors,
                targetIndex: guard.targetIndex,
                direction: guard.direction,
                coordinate: {x, y},
            });
            if (now >= guard.expiresAt || decision.action === 'release') {
                this._cancelGuardRestore();
                this._warpGuard = null;
                this._lastMonitorIndex = monitor?.index ?? null;
                this._lastMotion = {
                    x,
                    y,
                    monitorIndex: monitor?.index ?? null,
                };
                return Clutter.EVENT_PROPAGATE;
            }

            this._postWarpGuardEvents++;
            if (decision.action === 'restore') {
                this._queueGuardRestore(guard);
                this._lastMonitorIndex = guard.targetIndex;
                this._lastMotion = {
                    x: guard.x,
                    y: guard.y,
                    monitorIndex: guard.targetIndex,
                };
            }
            return Clutter.EVENT_PROPAGATE;
        }

        if (now < this._ignoreMotionUntil) {
            return Clutter.EVENT_PROPAGATE;
        }

        const previous = this._lastMotion;
        if (monitor && previous && previous.monitorIndex !== null &&
            monitor.index !== previous.monitorIndex) {
            this._monitorTransitions++;

            if (this._layout?.enabled === true) {
                this._routeAttempts++;
                const route = routeTransition({
                    logicalMonitors: monitors,
                    physicalLayout: this._layout.monitors,
                    skipScreenGaps: this._layout.skipScreenGaps === true,
                    sourceIndex: previous.monitorIndex,
                    targetIndex: monitor.index,
                    sourceCoordinate: previous,
                });
                const routeRecord = this._recordRoute({
                    ...route,
                    sourceIndex: previous.monitorIndex,
                    targetIndex: route.targetIndex ?? monitor.index,
                    sourceCoordinate: {x: previous.x, y: previous.y},
                });
                if (route.action === 'warp') {
                    this._warps++;
                    this._queueMotionWarp(
                        route.x,
                        route.y,
                        route.targetIndex ?? monitor.index,
                        routeRecord,
                    );
                    return Clutter.EVENT_PROPAGATE;
                }
                if (route.action === 'block') {
                    this._blockedEdgeHits++;
                    const rejection = rejectNativeTransition({
                        logicalMonitors: monitors,
                        sourceIndex: previous.monitorIndex,
                        targetIndex: monitor.index,
                        sourceCoordinate: previous,
                    });
                    if (rejection.action === 'warp-back') {
                        this._warps++;
                        this._rejectedTransitions++;
                        routeRecord.mode = 'reject-native';
                        routeRecord.guardDirection =
                            OPPOSITE_DIRECTION[routeRecord.direction];
                        routeRecord.returnPoint = {x: rejection.x, y: rejection.y};
                        this._queueMotionWarp(
                            rejection.x,
                            rejection.y,
                            rejection.targetIndex,
                            routeRecord,
                        );
                        return Clutter.EVENT_PROPAGATE;
                    }
                }
                this._nativePasses++;
            }
        }

        if (this._layout?.enabled === true &&
            monitor && previous && previous.monitorIndex === monitor.index) {
            const delta = this._relativeDelta(event, previous, x, y);
            const edgeRoute = routeEdgePush({
                logicalMonitors: monitors,
                physicalLayout: this._layout.monitors,
                skipScreenGaps: this._layout.skipScreenGaps === true,
                sourceIndex: monitor.index,
                sourceCoordinate: {x, y},
                delta,
            });
            if ((edgeRoute.action === 'warp' || edgeRoute.action === 'block') &&
                this._nativeBarrierCovers(
                    monitor,
                    edgeRoute.direction,
                    {x, y},
                )) {
                this._lastMonitorIndex = monitor.index;
                this._lastMotion = {x, y, monitorIndex: monitor.index};
                return Clutter.EVENT_PROPAGATE;
            }
            if (edgeRoute.action === 'warp') {
                this._routeAttempts++;
                this._warps++;
                this._edgePushes++;
                const routeRecord = this._recordRoute({
                    ...edgeRoute,
                    sourceIndex: monitor.index,
                    mode: 'edge-push',
                    delta,
                    sourceCoordinate: {x, y},
                });
                this._queueMotionWarp(
                    edgeRoute.x,
                    edgeRoute.y,
                    edgeRoute.targetIndex,
                    routeRecord,
                );
                return Clutter.EVENT_PROPAGATE;
            }
            if (edgeRoute.action === 'block') {
                const rejection = rejectNativeTransition({
                    logicalMonitors: monitors,
                    sourceIndex: monitor.index,
                    targetIndex: edgeRoute.targetIndex,
                    sourceCoordinate: {x, y},
                });
                this._routeAttempts++;
                this._blockedEdgeHits++;
                const routeRecord = this._recordRoute({
                    ...edgeRoute,
                    sourceIndex: monitor.index,
                    mode: 'edge-block',
                    delta,
                    sourceCoordinate: {x, y},
                });
                if (rejection.action === 'warp-back') {
                    this._warps++;
                    this._rejectedTransitions++;
                    routeRecord.guardDirection =
                        OPPOSITE_DIRECTION[routeRecord.direction];
                    routeRecord.returnPoint = {x: rejection.x, y: rejection.y};
                    this._queueMotionWarp(
                        rejection.x,
                        rejection.y,
                        rejection.targetIndex,
                        routeRecord,
                    );
                }
                return Clutter.EVENT_PROPAGATE;
            }
        }

        if (monitor)
            this._lastMonitorIndex = monitor.index;

        this._lastMotion = {
            x,
            y,
            monitorIndex: monitor?.index ?? null,
        };

        return Clutter.EVENT_PROPAGATE;
    }
}
