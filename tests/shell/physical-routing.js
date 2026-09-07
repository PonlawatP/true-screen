import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

const UUID = 'true-screen@plutostudio.io';

let virtualPointer = null;

function expect(condition, message) {
    if (!condition)
        throw new Error(message);
}

function expectNear(actual, expected, message) {
    if (Math.abs(actual - expected) > 2)
        throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

function delay(milliseconds) {
    return new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, milliseconds, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

export function init() {
    global.connect('shutdown', () => {
        virtualPointer = null;
    });
}

export async function run() {
    await Scripting.waitLeisure();
    const monitors = Main.layoutManager.monitors;
    expect(monitors.length === 2, `Expected 2 monitors, got ${monitors.length}`);

    const extension = Main.extensionManager.lookup(UUID);
    expect(extension?.stateObj, `Extension ${UUID} was not enabled`);
    const instance = extension.stateObj;

    const source = monitors[0];
    const target = monitors[1];
    const sourcePhysical = {x: 0, y: 0, width: 500, height: 300};
    const targetPhysical = {x: 500, y: -50, width: 600, height: 340};
    const layout = {
        schemaVersion: 1,
        enabled: true,
        rulerOverlay: {
            enabled: true,
            firstIndex: source.index,
            secondIndex: target.index,
        },
        monitors: [
            {index: source.index, physical: sourcePhysical},
            {index: target.index, physical: targetPhysical},
        ],
    };

    const configDir = GLib.build_filenamev([
        GLib.get_user_config_dir(),
        'true-screen',
    ]);
    GLib.mkdir_with_parents(configDir, 0o700);
    GLib.file_set_contents(
        GLib.build_filenamev([configDir, 'layout.json']),
        JSON.stringify(layout),
    );
    instance._implementation._loadLayout();
    for (let attempt = 0; attempt < 80; attempt++) {
        const state = JSON.parse(instance.GetState());
        if (state.routingEnabled && state.desktopRulerActors === 2)
            break;
        await delay(25);
    }
    const initialState = JSON.parse(instance.GetState());
    expect(initialState.routingEnabled,
        'Extension file monitor did not enable routing from GUI-compatible config');
    expect(initialState.desktopRulerActors === 2,
        'Extension did not create a desktop ruler actor for both selected monitors');
    expect(Object.values(initialState.lifecycleWatchers).every(Boolean),
        `Extension lifecycle watchers are incomplete: ` +
        `${JSON.stringify(initialState.lifecycleWatchers)}`);
    // Allow the initial file-monitor notification to settle before asserting
    // a separate lifecycle sync reason.
    await delay(100);
    instance._implementation._scheduleLifecycleSync('integration-lifecycle', [0]);
    for (let attempt = 0; attempt < 80; attempt++) {
        const state = JSON.parse(instance.GetState());
        if (state.lastLayoutSyncReason === 'integration-lifecycle' &&
            state.lastLayoutSyncStatus === 'matched')
            break;
        await delay(25);
    }
    expect(JSON.parse(instance.GetState()).lastLayoutSyncReason ===
        'integration-lifecycle',
    'Lifecycle-triggered profile reactivation did not complete');
    const desktopRulerActors = JSON.parse(instance.GetState()).desktopRulerActors;
    const previewLayout = {
        ...layout,
        monitors: [
            layout.monitors[0],
            {
                ...layout.monitors[1],
                physical: {...targetPhysical, y: targetPhysical.y + 80},
            },
        ],
    };
    instance._implementation.PreviewRuler(JSON.stringify(previewLayout));
    const previewState = JSON.parse(instance.GetState());
    expect(previewState.rulerPreviewActive && previewState.desktopRulerActors === 2,
        'Draft ruler preview did not replace the desktop ruler actors');
    expect(instance._implementation._layout.monitors[1].physical.y === targetPhysical.y,
        'Draft ruler preview mutated the applied routing layout');
    instance._implementation.ClearRulerPreview();
    const clearedPreviewState = JSON.parse(instance.GetState());
    expect(!clearedPreviewState.rulerPreviewActive &&
        clearedPreviewState.desktopRulerActors === 0,
    'Closing the draft ruler preview did not remove its desktop actors');

    const seat = Clutter.get_default_backend().get_default_seat();
    virtualPointer = seat.create_virtual_device(
        Clutter.InputDeviceType.POINTER_DEVICE,
    );

    const sourceX = Math.round(source.x + source.width / 2);
    const sourceY = Math.round(source.y + source.height / 2);
    virtualPointer.notify_absolute_motion(
        GLib.get_monotonic_time(),
        sourceX,
        sourceY,
    );
    await Scripting.waitLeisure();
    const observedSource = JSON.parse(instance.GetState()).lastMotion;
    expect(observedSource?.monitorIndex === source.index,
        `First motion was not observed on source monitor ${source.index}`);

    virtualPointer.notify_absolute_motion(
        GLib.get_monotonic_time(),
        target.x + 5,
        sourceY,
    );
    await Scripting.waitLeisure();
    await delay(20);

    for (let attempt = 0; attempt < 30; attempt++) {
        const state = JSON.parse(instance.GetState());
        if (!state.barrierWarpPending && !state.barriersSuspended)
            break;
        await delay(10);
    }
    const mappedState = JSON.parse(instance.GetState());
    const mappedSourceY = mappedState.lastRoute?.mode === 'barrier'
        ? mappedState.lastRoute.sourceCoordinate.y
        : observedSource.y;
    const mappedSourceRatio = (mappedSourceY - source.y) / source.height;
    const physicalY = sourcePhysical.y + mappedSourceRatio * sourcePhysical.height;
    const targetRatio = (physicalY - targetPhysical.y) / targetPhysical.height;
    const expectedX = mappedState.lastRoute?.mode === 'barrier'
        ? mappedState.lastRoute.x
        : target.x + 2;
    const expectedY = target.y + targetRatio * target.height;
    const [pointerX, pointerY] = global.get_pointer();

    expectNear(pointerX, expectedX, 'Physically mapped pointer X');
    expectNear(pointerY, expectedY, 'Physically mapped pointer Y');
    expect(Math.abs(pointerY - sourceY) > 50,
        'Routing did not materially adjust the cursor for physical size/offset');
    expect(mappedState.warps >= 1 && mappedState.lastRoute?.action === 'warp',
        'Extension telemetry did not record the physical pointer warp');

    const implementation = instance._implementation;
    if (implementation._barriersSuspended) {
        implementation._onEvent({
            type: () => Clutter.EventType.MOTION,
            get_coords: () => [pointerX, pointerY],
        }, null);
    }
    const activeBarrierState = JSON.parse(instance.GetState());
    expect(activeBarrierState.edgeBarrierCount > 0 &&
        activeBarrierState.edgeBarrierActionCount >= 2 &&
        activeBarrierState.nativeBarrierCornerInset === 0 &&
        activeBarrierState.edgeBarrierError === null,
    `Extension did not create native barriers: ` +
        `${JSON.stringify(activeBarrierState)}`);
    const endpointCoverage = {
        sourceTop: implementation._nativeBarrierCovers(source, 'right', {
        x: source.x + source.width,
        y: source.y,
        }),
        sourceBottom: implementation._nativeBarrierCovers(source, 'right', {
        x: source.x + source.width,
        y: source.y + source.height - 1,
        }),
        targetTop: implementation._nativeBarrierCovers(target, 'left', {
        x: target.x,
        y: target.y,
        }),
        targetBottom: implementation._nativeBarrierCovers(target, 'left', {
        x: target.x,
        y: target.y + target.height - 1,
        }),
    };
    // Only an endpoint shared by both logical monitors is a seam. The source
    // can extend below the shorter target in this headless layout, so its
    // bottom-right corner correctly has no barrier to cross.
    expect(endpointCoverage.sourceTop && endpointCoverage.targetTop &&
        endpointCoverage.targetBottom,
        `Main native barriers did not cover every shared seam endpoint: ` +
        `${JSON.stringify(endpointCoverage)}`);

    const blockingLayout = {
        ...layout,
        monitors: [
            layout.monitors[0],
            {
                index: target.index,
                physical: {
                    ...targetPhysical,
                    y: sourcePhysical.y + 50,
                    height: 100,
                },
            },
        ],
    };
    GLib.file_set_contents(
        GLib.build_filenamev([configDir, 'layout.json']),
        JSON.stringify(blockingLayout),
    );
    implementation._loadLayout();
    await delay(100);
    expect(implementation._barrierWarpPending === null,
        'Previous mapped warp was still cooling down before block test');
    const blockedSpec = implementation._edgeBarrierActions.find(spec =>
        spec.sourceIndex === source.index &&
        spec.direction === 'right' &&
        spec.mode === 'block');
    expect(blockedSpec !== undefined && implementation._edgeBarriers.length > 0,
        'Extension did not retain hybrid native block geometry');
    implementation._warpGuard = null;
    const blockedY = Math.round(
        (blockedSpec.y1 + blockedSpec.y2) / 2,
    );
    implementation._seat.warp_pointer(
        source.x + source.width - 40,
        blockedY,
    );
    implementation._lastMotion = {
        x: source.x + source.width - 40,
        y: blockedY,
        monitorIndex: source.index,
    };
    await delay(10);
    virtualPointer.notify_absolute_motion(
        GLib.get_monotonic_time(),
        target.x + 40,
        blockedY,
    );
    await Scripting.waitLeisure();
    await delay(20);
    virtualPointer.notify_absolute_motion(
        GLib.get_monotonic_time(),
        target.x + 100,
        blockedY,
    );
    await Scripting.waitLeisure();
    await delay(20);
    const [blockedX, blockedPointerY] = global.get_pointer();
    const blockedState = JSON.parse(instance.GetState());
    expect(blockedX <= source.x + source.width,
        `Pointer leaked through the source-only seam to ` +
        `${blockedX},${blockedPointerY}: ${JSON.stringify(blockedState)}`);
    expect(blockedState.blockedEdgeHits >= 1 &&
        ['barrier-block', 'edge-block', 'reject-native'].includes(
            blockedState.lastRoute?.mode,
        ) &&
        blockedState.lastRoute?.sourceIndex === source.index &&
        blockedState.lastRoute?.returnPoint?.x < target.x &&
        blockedState.lastRoute?.returnPoint?.y === blockedY &&
        (blockedState.lastRoute?.direction ?? 'right') === 'right',
    `Extension telemetry did not record the blocked edge: ` +
        `${JSON.stringify(blockedState)}`);

    const warpsBeforeRetreat = blockedState.warps;
    virtualPointer.notify_absolute_motion(
        GLib.get_monotonic_time(),
        source.x + source.width - 80,
        blockedY,
    );
    await Scripting.waitLeisure();
    await delay(20);
    const [retreatX, retreatY] = global.get_pointer();
    const retreatState = JSON.parse(instance.GetState());
    expect(retreatX < source.x + source.width &&
        retreatState.warps === warpsBeforeRetreat,
    `Retreating from a blocked edge caused a reverse warp to ` +
        `${retreatX},${retreatY}: ${JSON.stringify(retreatState)}`);

    for (const edgeY of [blockedSpec.rangeStart, blockedSpec.rangeEnd]) {
        implementation._seat.warp_pointer(
            source.x + source.width - 40,
            edgeY - (edgeY === blockedSpec.rangeEnd ? 1 : 0),
        );
        implementation._lastMotion = {
            x: source.x + source.width - 40,
            y: edgeY - (edgeY === blockedSpec.rangeEnd ? 1 : 0),
            monitorIndex: source.index,
        };
        await delay(10);
        virtualPointer.notify_absolute_motion(
            GLib.get_monotonic_time(),
            target.x + 40,
            edgeY,
        );
        await Scripting.waitLeisure();
        await delay(20);
        const [edgeX] = global.get_pointer();
        const edgeState = JSON.parse(instance.GetState());
        expect(edgeX <= source.x + source.width &&
            edgeState.lastRoute?.action === 'block' &&
            ['barrier-block', 'edge-block', 'reject-native'].includes(
                edgeState.lastRoute?.mode,
            ),
        `Partition/corner movement escaped or warped at y=${edgeY}: ` +
            `${JSON.stringify(edgeState)}`);
    }

    implementation._ignoreMotionUntil = 0;
    implementation._warpGuard = null;
    implementation._seat.warp_pointer(target.x + 40, blockedY);
    implementation._lastMotion = {
        x: target.x + 40,
        y: blockedY,
        monitorIndex: target.index,
    };
    await delay(10);
    virtualPointer.notify_absolute_motion(
        GLib.get_monotonic_time(),
        source.x + source.width - 40,
        blockedY,
    );
    await Scripting.waitLeisure();
    await delay(30);
    const [reverseFullX, reverseFullY] = global.get_pointer();
    const reverseFullState = JSON.parse(instance.GetState());
    expect(reverseFullX < source.x + source.width,
        `Fully connected reverse edge was blocked at ` +
        `${reverseFullX},${reverseFullY}`);
    expect(reverseFullState.lastRoute?.action === 'warp' &&
        reverseFullState.lastRoute?.sourceIndex === target.index &&
        reverseFullState.lastRoute?.direction === 'left',
    `Reverse full-edge route used the wrong source: ` +
        `${JSON.stringify(reverseFullState)}`);
    GLib.file_set_contents(
        GLib.build_filenamev([configDir, 'layout.json']),
        JSON.stringify(layout),
    );
    implementation._loadLayout();
    await delay(20);

    const reverseSpec = implementation._edgeBarrierActions.find(spec =>
        spec.sourceIndex === target.index &&
        spec.targetIndex === source.index &&
        spec.direction === 'left');
    expect(reverseSpec !== undefined && implementation._edgeBarriers.length > 0,
        'Reverse route did not retain corner-trimmed native barriers');

    const edgeX = source.x + source.width - 2;
    const edgeY = Math.min(
        source.y + source.height - 10,
        target.y + target.height + 100,
    );
    expect(edgeY >= target.y + target.height,
        'Headless monitor geometry has no source-only edge segment');
    implementation._destroyEdgeBarriers();
    implementation._barriersSuspended = false;
    implementation._ignoreMotionUntil = 0;
    implementation._warpGuard = null;
    implementation._lastMotion = {
        x: edgeX - 10,
        y: edgeY,
        monitorIndex: source.index,
    };
    const observedEdge = {...implementation._lastMotion};
    const edgePushResult = implementation._onEvent({
        type: () => Clutter.EventType.MOTION,
        get_coords: () => [edgeX, edgeY],
        get_relative_motion: () => [true, 20, 0, 20, 0, 0, 0],
    }, null);
    expect(edgePushResult === Clutter.EVENT_PROPAGATE,
        'Proactive edge route swallowed GNOME Shell motion dispatch');
    await Scripting.waitLeisure();
    const [edgePushX, edgePushY] = global.get_pointer();
    const edgePushState = JSON.parse(instance.GetState());
    expect(edgePushX >= target.x && edgePushX < target.x + target.width,
        `Proactive edge push did not enter target: ${edgePushX},${edgePushY}`);
    expect(edgePushState.edgePushes >= 1 &&
        edgePushState.lastRoute?.mode === 'edge-push',
        `Extension telemetry did not record proactive edge routing: ` +
        `${JSON.stringify(edgePushState)}`);

    const restoresBeforeStaleBurst = edgePushState.postWarpRestores;
    let staleMotionResult = null;
    for (let motion = 0; motion < 20; motion++) {
        staleMotionResult = implementation._onEvent({
            type: () => Clutter.EventType.MOTION,
            get_coords: () => [source.x + source.width - 2, edgeY],
            get_relative_motion: () => [true, -1, 0, -1, 0, 0, 0],
        }, null);
    }
    expect(staleMotionResult === Clutter.EVENT_PROPAGATE,
        'Post-warp guard swallowed a stale source-monitor event');
    await Scripting.waitLeisure();
    const [guardedX, guardedY] = global.get_pointer();
    const guardedState = JSON.parse(instance.GetState());
    expect(guardedX >= target.x && guardedX < target.x + target.width,
        `Post-warp guard did not keep the pointer on target: ${guardedX},${guardedY}`);
    expect(guardedState.postWarpRestores - restoresBeforeStaleBurst === 1 &&
        !guardedState.pendingMotionWarp,
    'Post-warp guard did not coalesce a stale-motion burst into one restore');

    implementation._onEvent({
        type: () => Clutter.EventType.MOTION,
        get_coords: () => [target.x + 20, edgePushY],
        get_relative_motion: () => [true, 18, 0, 18, 0, 0, 0],
    }, null);
    expect(implementation._warpGuard === null,
        'Post-warp guard did not release after entering the target display');

    implementation._ignoreMotionUntil = 0;
    implementation._warpGuard = null;
    implementation._lastMotion = {
        x: target.x + 2,
        y: target.y,
        monitorIndex: target.index,
    };
    const rejectionResult = implementation._onEvent({
        type: () => Clutter.EventType.MOTION,
        get_coords: () => [source.x + source.width - 2, source.y],
        get_relative_motion: () => [true, -20, 0, -20, 0, 0, 0],
    }, null);
    expect(rejectionResult === Clutter.EVENT_PROPAGATE,
        'Rejected native route swallowed GNOME Shell motion dispatch');
    await Scripting.waitLeisure();
    const [rejectedX, rejectedY] = global.get_pointer();
    const rejectedState = JSON.parse(instance.GetState());
    expect(rejectedState.rejectedTransitions >= 1 &&
        rejectedState.lastRoute?.mode === 'reject-native',
        'Invalid native transition was not rejected');
    expect(rejectedX >= target.x && rejectedX < target.x + target.width,
        `Rejected transition did not return to source: ${rejectedX},${rejectedY}`);

    const separatedLayout = {
        ...layout,
        rulerOverlay: {...layout.rulerOverlay, enabled: false},
        monitors: [
            {index: source.index, physical: sourcePhysical},
            {index: target.index, physical: {...targetPhysical, x: 700}},
        ],
    };
    GLib.file_set_contents(
        GLib.build_filenamev([configDir, 'layout.json']),
        JSON.stringify(separatedLayout),
    );
    implementation._loadLayout();
    for (let attempt = 0; attempt < 80; attempt++) {
        const state = JSON.parse(instance.GetState());
        if (state.lastLayoutSyncReason === 'manual' &&
            state.lastLayoutSyncStatus === 'matched' &&
            implementation._layout?.monitors[1]?.physical.x === 700)
            break;
        await delay(25);
    }
    await delay(75);
    implementation._ignoreMotionUntil = 0;
    implementation._warpGuard = null;
    implementation._lastMotion = {
        x: source.x + source.width - 2,
        y: sourceY,
        monitorIndex: source.index,
    };
    implementation._seat.warp_pointer(target.x + 5, sourceY);
    implementation._onEvent({
        type: () => Clutter.EventType.MOTION,
        get_coords: () => [target.x + 5, sourceY],
        get_relative_motion: () => [true, 20, 0, 20, 0, 0, 0],
    }, null);
    await Scripting.waitLeisure();
    await delay(25);
    const [separatedX, separatedY] = global.get_pointer();
    expect(separatedX >= source.x && separatedX < source.x + source.width,
        `Unmapped edge leaked pointer to ${separatedX},${separatedY}`);
    const separatedState = JSON.parse(instance.GetState());
    expect(separatedState.rejectedTransitions > rejectedState.rejectedTransitions &&
        separatedState.lastRoute?.action === 'block' &&
        separatedState.lastRoute?.reason === 'not-adjacent' &&
        separatedState.lastRoute?.mode === 'reject-native',
        `Extension telemetry did not record the blocked unmapped seam: ` +
        `${JSON.stringify(separatedState)}`);

    // The same separated seam becomes traversable after applying the opt-in.
    GLib.file_set_contents(
        GLib.build_filenamev([configDir, 'layout.json']),
        JSON.stringify({...separatedLayout, skipScreenGaps: true}),
    );
    implementation._loadLayout();
    for (let attempt = 0; attempt < 80; attempt++) {
        if (JSON.parse(instance.GetState()).skipScreenGaps)
            break;
        await delay(25);
    }
    expect(JSON.parse(instance.GetState()).skipScreenGaps,
        'Gap setting did not activate after config reload');
    expect(implementation._edgeBarrierActions.some(action =>
        action.sourceIndex === source.index && action.mode === 'warp'),
    'Gap setting did not rebuild mapped barriers');
    implementation._ignoreMotionUntil = 0;
    implementation._warpGuard = null;
    implementation._lastMotion = {
        x: source.x + source.width - 2,
        y: sourceY,
        monitorIndex: source.index,
    };
    implementation._seat.warp_pointer(target.x + 5, sourceY);
    implementation._onEvent({
        type: () => Clutter.EventType.MOTION,
        get_coords: () => [target.x + 5, sourceY],
        get_relative_motion: () => [true, 20, 0, 20, 0, 0, 0],
    }, null);
    await Scripting.waitLeisure();
    await delay(25);
    const [gapX, gapY] = global.get_pointer();
    expect(gapX >= target.x && gapX < target.x + target.width,
        `Enabled gap crossing did not reach target: ${gapX},${gapY}`);
    expectNear(gapY, target.y +
        ((sourceY - source.y) / source.height * sourcePhysical.height -
            targetPhysical.y) / targetPhysical.height * target.height,
    'Gap crossing did not preserve physical height');

    // A native barrier event sequence continues while sliding along the edge.
    // A blocked segment must not latch the whole sequence after entering a
    // mapped segment, including a steep diagonal push against a vertical edge.
    GLib.file_set_contents(
        GLib.build_filenamev([configDir, 'layout.json']),
        JSON.stringify({...blockingLayout, skipScreenGaps: true}),
    );
    implementation._loadLayout();
    await delay(100);
    const slidingEntry = {
        spec: {vertical: true},
        barrier: {release() {}},
    };
    const seamX = source.x + source.width;
    const closedY = source.y + 10;
    const slideY = source.y + source.height / 3;
    implementation._warpGuard = null;
    implementation._ignoreMotionUntil = 0;
    implementation._lastMotion = {
        x: seamX - 2, y: closedY, monitorIndex: source.index,
    };
    implementation._onBarrierHit(slidingEntry, {
        event_id: 987654, x: seamX, y: closedY, dx: 2, dy: -20,
    });
    await Scripting.waitLeisure();
    expect(implementation._lastRoute.action === 'block',
        'Sliding regression did not start on a closed edge');
    await delay(20);
    implementation._onBarrierHit(slidingEntry, {
        event_id: 987654, x: seamX, y: slideY, dx: 2, dy: -20,
    });
    await Scripting.waitLeisure();
    await delay(40);
    expect(implementation._lastRoute.action === 'warp' &&
        implementation._lastRoute.targetIndex === target.index,
    'Sliding the same event sequence onto a mapped edge remained stuck');

    // A new native crossing supersedes a guard from an earlier fallback warp.
    implementation._warpGuard = {
        sourceIndex: target.index, targetIndex: source.index,
        direction: 'left', x: seamX - 2, y: sourceY,
        expiresAt: GLib.get_monotonic_time() + 250_000,
    };
    implementation._queueGuardRestore(implementation._warpGuard);
    implementation._warpAndRemember(target.x + 20, gapY, target.index,
        {sourceIndex: source.index, direction: 'right'}, false);
    expect(implementation._warpGuard === null &&
        implementation._pendingGuardRestoreSourceId === 0,
    'New crossing retained a stale guard or queued restore from the previous screen');

    expect(Object.values(JSON.parse(instance.GetState()).grabWatchers).every(Boolean),
        'Window-grab lifecycle signals were not registered');
    implementation._queueMotionWarp(source.x + 20, sourceY, source.index);
    implementation._setWindowGrabActive(true);
    expect(implementation._pendingMotionWarpSourceId === 0 &&
        implementation._warpGuard === null,
    'Window move retained pre-grab corrections');
    expect(implementation._edgeBarriers.length > 0 &&
        implementation._edgeBarrierActions.every(action => action.mode === 'warp'),
    'Window move lost mapped passages or retained blocking barriers');
    implementation._rebuildEdgeBarriers(monitors, implementation._layout);
    expect(implementation._edgeBarriers.length > 0 &&
        implementation._edgeBarrierActions.every(action => action.mode === 'warp'),
    'Layout reload did not retain move-compatible routing');

    implementation._lastMotion = {x: seamX - 2, y: slideY, monitorIndex: source.index};
    implementation._onBarrierHit(slidingEntry, {
        x: seamX, y: slideY, dx: 2, dy: -20,
    });
    await delay(50);
    expect(implementation._lastRoute.action === 'warp' &&
        implementation._lastRoute.targetIndex === target.index &&
        implementation._warpGuard === null,
    'Mapped window-drag crossing did not warp without a restore guard');
    const blockedWarpsBefore = implementation._warps;
    implementation._lastMotion = {x: seamX - 2, y: closedY, monitorIndex: source.index};
    implementation._onEvent({
        type: () => Clutter.EventType.MOTION,
        get_coords: () => [target.x + 20, closedY],
    }, null);
    expect(implementation._warps === blockedWarpsBefore &&
        implementation._lastMotion.monitorIndex === target.index,
    'An unmapped drag passage triggered warp-back instead of native movement');
    implementation._setWindowGrabActive(false);

    // Resize grabs still use native movement, and invalidate queued crossings.
    implementation._lastMotion = {x: seamX - 2, y: slideY, monitorIndex: source.index};
    implementation._onBarrierHit(slidingEntry, {
        x: seamX, y: slideY, dx: 2, dy: 0,
    });
    implementation._setWindowGrabActive(true, Meta.GrabOp.RESIZING_E);
    const resizeStart = global.get_pointer().slice(0, 2);
    await delay(40);
    expect(global.get_pointer()[0] === resizeStart[0] &&
        global.get_pointer()[1] === resizeStart[1] &&
        implementation._edgeBarriers.length === 0,
    'Deferred crossing survived resize-grab start');
    implementation._setWindowGrabActive(false);

    // Reproduce the live loop: the compositor refuses to leave the current
    // monitor, although warp_pointer itself returns without an error.
    implementation._setWindowGrabActive(true);
    const actualBeforeRefusal = implementation._rememberActualPointer();
    const refusedMonitor = actualBeforeRefusal.monitorIndex === source.index ? target : source;
    const realSeat = implementation._seat;
    const refusedRoute = {sourceIndex: actualBeforeRefusal.monitorIndex, direction: 'left'};
    try {
        implementation._seat = {warp_pointer() {}};
        const warped = implementation._warpAndRemember(
            refusedMonitor.x + 20, refusedMonitor.y + 20, refusedMonitor.index,
            refusedRoute);
        await delay(40);
        expect(warped === true && refusedRoute.warpRefused === 'compositor-constrained',
            'Compositor refusal was recorded as a successful warp');
        expect(implementation._lastMotion.monitorIndex === actualBeforeRefusal.monitorIndex &&
            implementation._warpGuard === null,
        'Refused warp retained a fictional source monitor or restore guard');
        const attemptsAfterRefusal = implementation._routeAttempts;
        for (let motion = 0; motion < 20; motion++) {
            implementation._onEvent({
                type: () => Clutter.EventType.MOTION,
                get_coords: () => [actualBeforeRefusal.x, actualBeforeRefusal.y],
            }, null);
        }
        expect(implementation._routeAttempts === attemptsAfterRefusal &&
            implementation._dragRoutingFailed && implementation._edgeBarriers.length === 0,
            'Refused warp entered a repeated correction loop');
    } finally {
        implementation._seat = realSeat;
        implementation._setWindowGrabActive(false);
    }

    // Exercise a real GTK window and Mutter move grab, not only event-shaped
    // stubs. A held-button drag must carry both pointer and window across a gap.
    const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
    launcher.setenv('GDK_BACKEND', 'wayland', true);
    const client = launcher.spawnv(['gjs', '-c', `
        imports.gi.versions.Gtk = '4.0';
        const Gtk = imports.gi.Gtk;
        const app = new Gtk.Application({application_id: 'io.plutostudio.TrueScreen.DragTest'});
        app.connect('activate', () => {
            const window = new Gtk.ApplicationWindow({application: app,
                title: 'True Screen Drag Regression', default_width: 400, default_height: 240});
            window.set_child(new Gtk.Label({label: 'Drag across the physical gap'}));
            window.present();
        });
        app.run([]);
    `]);
    let dragWindow = null;
    const liveDrag = {};
    try {
        for (let attempt = 0; attempt < 80; attempt++) {
            dragWindow = global.get_window_actors().map(actor => actor.meta_window)
                .find(window => window.get_title() === 'True Screen Drag Regression');
            if (dragWindow)
                break;
            await delay(25);
        }
        expect(dragWindow !== null && dragWindow !== undefined,
            'GTK drag test window did not appear');
        GLib.file_set_contents(
            GLib.build_filenamev([configDir, 'layout.json']),
            JSON.stringify({...separatedLayout, skipScreenGaps: true}),
        );
        implementation._loadLayout();
        await delay(100);
        dragWindow.move_frame(true, source.x + 300, source.y + 300);
        dragWindow.activate(global.get_current_time());
        await delay(75);
        const frameBefore = dragWindow.get_frame_rect();
        const dragX = frameBefore.x + 150;
        const dragY = frameBefore.y + 50;
        virtualPointer.notify_absolute_motion(GLib.get_monotonic_time(), dragX, dragY);
        await delay(30);
        virtualPointer.notify_button(GLib.get_monotonic_time(), 1, Clutter.ButtonState.PRESSED);
        await delay(30);
        expect(dragWindow.begin_grab_op(Meta.GrabOp.MOVING,
            Clutter.get_default_backend().get_pointer_sprite(global.stage),
            global.get_current_time(), null), 'Mutter refused the test move grab');
        expect(implementation._windowGrabActive && implementation._windowMoveActive,
            'Real move grab did not activate drag routing');
        virtualPointer.notify_absolute_motion(GLib.get_monotonic_time(), seamX + 60, dragY);
        for (let attempt = 0; attempt < 40; attempt++) {
            await delay(25);
            if (global.get_pointer()[0] >= target.x &&
                dragWindow.get_monitor() === target.index &&
                !implementation._barrierWarpPending)
                break;
        }
        const [forwardX, forwardY] = global.get_pointer();
        const frameAfter = dragWindow.get_frame_rect();
        expect(forwardX >= target.x && forwardX < target.x + target.width &&
            frameAfter.x > frameBefore.x + 500 &&
            dragWindow.get_monitor() === target.index,
        `Held-button gap drag did not carry window and pointer: ` +
            `${JSON.stringify({forwardX, forwardY, frameBefore, frameAfter})}`);
        expect(implementation._windowGrabActive && !implementation._dragRoutingFailed,
            'Gap crossing ended or disabled the active move grab');
        liveDrag.forward = {pointer: {x: forwardX, y: forwardY}, windowX: frameAfter.x};
        virtualPointer.notify_absolute_motion(GLib.get_monotonic_time(), seamX - 60, forwardY);
        for (let attempt = 0; attempt < 40; attempt++) {
            await delay(25);
            if (global.get_pointer()[0] < seamX &&
                dragWindow.get_monitor() === source.index &&
                !implementation._barrierWarpPending)
                break;
        }
        const [reverseX, reverseY] = global.get_pointer();
        expect(reverseX < seamX && dragWindow.get_monitor() === source.index &&
            implementation._windowGrabActive,
            'Continuous reverse drag did not return window and pointer to source: ' +
                JSON.stringify({reverseX, reverseY, frame: dragWindow.get_frame_rect(),
                    windowMonitor: dragWindow.get_monitor(), state: JSON.parse(instance.GetState())}));
        liveDrag.reverse = {pointer: {x: reverseX, y: reverseY},
            windowX: dragWindow.get_frame_rect().x};
        virtualPointer.notify_button(GLib.get_monotonic_time(), 1, Clutter.ButtonState.RELEASED);
        await delay(50);
        expect(!implementation._windowGrabActive,
            'Button release did not finish the real move grab');
    } finally {
        virtualPointer.notify_button(GLib.get_monotonic_time(), 1, Clutter.ButtonState.RELEASED);
        dragWindow?.delete(global.get_current_time());
        client.force_exit();
    }

    const result = {
        passed: true,
        activeMonitors: monitors.length,
        liveDrag,
        source: {index: source.index, x: sourceX, y: sourceY},
        observedSource,
        barrierFreeSafeMode: {
            nativeBarrierCount: activeBarrierState.edgeBarrierCount,
            actionCount: activeBarrierState.edgeBarrierActionCount,
        },
        blockedEdge: {
            target: {x: blockedX, y: blockedPointerY},
            hits: blockedState.blockedEdgeHits,
        },
        reverseFullEdge: {
            target: {x: reverseFullX, y: reverseFullY},
        },
        target: {index: target.index, x: pointerX, y: pointerY},
        expected: {x: expectedX, y: expectedY},
        physicalLayout: [sourcePhysical, targetPhysical],
        desktopRulerActors,
        proactiveEdgePush: {
            source: observedEdge,
            target: {x: edgePushX, y: edgePushY},
            count: edgePushState.edgePushes,
        },
        postWarpGuard: {
            target: {x: guardedX, y: guardedY},
            restores: guardedState.postWarpRestores,
        },
        rejectedNativeTransition: {
            target: {x: rejectedX, y: rejectedY},
            count: rejectedState.rejectedTransitions,
        },
        skippedGapPointer: {x: gapX, y: gapY},
        separatedEdgePointer: {x: separatedX, y: separatedY},
        telemetry: {
            warps: separatedState.warps,
            nativePasses: separatedState.nativePasses,
            lastRoute: separatedState.lastRoute,
        },
    };
    const resultJson = JSON.stringify(result);
    const resultFile = GLib.getenv('TRUE_SCREEN_ROUTING_RESULT_FILE');
    if (resultFile)
        GLib.file_set_contents(resultFile, resultJson);
    console.log(`[True Screen Routing Test] ${resultJson}`);
}

export function finish() {}
