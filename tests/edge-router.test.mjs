import assert from 'node:assert/strict';
import test from 'node:test';

import {
    adjacentPhysicalMonitors,
    barrierActionAtCoordinate,
    centerOf,
    clampPointToMonitor,
    containsPoint,
    edgeBarrierSpecs,
    findMonitor,
    mapEdgeCoordinate,
    mergedBarrierGeometry,
    mappedPhysicalEdge,
    nextMonitor,
    rejectNativeTransition,
    routeEdgePush,
    routeTransition,
    topCornerBarrierGeometry,
    trimBarrierGeometryFromCorners,
    warpGuardDecision,
} from '../extension/true-screen@plutostudio.io/edge-router.js';
import {
    compareIntervals,
    rulerMetrics,
} from '../app/ruler-geometry.js';
import {
    alignSizeToLogical,
    orientDetectedSize,
    rotationName,
} from '../app/monitor-transform.js';

const monitors = [
    {index: 4, x: -1920, y: 0, width: 1920, height: 1080},
    {index: 8, x: 0, y: 100, width: 2560, height: 1440},
];

test('containsPoint uses half-open right and bottom edges', () => {
    const rect = {x: 10, y: 20, width: 100, height: 50};
    assert.equal(containsPoint(rect, 10, 20), true);
    assert.equal(containsPoint(rect, 109.999, 69.999), true);
    assert.equal(containsPoint(rect, 110, 30), false);
    assert.equal(containsPoint(rect, 50, 70), false);
});

test('findMonitor supports negative desktop coordinates', () => {
    assert.equal(findMonitor(monitors, -100, 500)?.index, 4);
    assert.equal(findMonitor(monitors, 100, 500)?.index, 8);
    assert.equal(findMonitor(monitors, 100, 50), null);
});

test('nextMonitor follows list order and wraps', () => {
    assert.equal(nextMonitor(monitors, 4)?.index, 8);
    assert.equal(nextMonitor(monitors, 8)?.index, 4);
    assert.equal(nextMonitor([], 4), null);
});

test('centerOf returns the logical center', () => {
    assert.deepEqual(centerOf(monitors[0]), {x: -960, y: 540});
});

test('clampPointToMonitor keeps warp coordinates inside half-open geometry', () => {
    const monitor = {x: 1920, y: 0, width: 1920, height: 1080};

    assert.deepEqual(
        clampPointToMonitor(monitor, 3840, 1080),
        {x: 3839, y: 1079},
    );
    assert.equal(clampPointToMonitor(monitor, Number.NaN, 400), null);
});

test('all physically adjacent monitor pairs are discovered', () => {
    const entries = [
        {index: 0, physical: {x: 0, y: 0, width: 100, height: 100}},
        {index: 1, physical: {x: 100, y: 0, width: 100, height: 100}},
        {index: 2, physical: {x: 200, y: 25, width: 100, height: 100}},
    ];

    assert.deepEqual(
        adjacentPhysicalMonitors(entries[0], entries).map(entry => entry.index),
        [1],
    );
    assert.deepEqual(
        adjacentPhysicalMonitors(entries[1], entries).map(entry => entry.index),
        [0, 2],
    );
    assert.equal(mappedPhysicalEdge(entries[1], entries[2])?.edge, 'right');
});

test('mapEdgeCoordinate preserves physical height across unequal displays', () => {
    const coordinate = mapEdgeCoordinate({
        coordinate: 540,
        axis: 'y',
        sourceLogical: {x: 0, y: 0, width: 1920, height: 1080},
        targetLogical: {x: 1920, y: 0, width: 2560, height: 1440},
        sourcePhysical: {x: 0, y: 0, width: 530, height: 300},
        targetPhysical: {x: 530, y: -50, width: 600, height: 340},
    });

    assert.equal(coordinate, 200 / 340 * 1440);
});

test('mapEdgeCoordinate rejects a physical point outside the target edge', () => {
    const coordinate = mapEdgeCoordinate({
        coordinate: 50,
        axis: 'y',
        sourceLogical: {x: 0, y: 0, width: 1920, height: 1080},
        targetLogical: {x: 1920, y: 0, width: 2560, height: 1440},
        sourcePhysical: {x: 0, y: 0, width: 530, height: 300},
        targetPhysical: {x: 530, y: 100, width: 600, height: 200},
    });

    assert.equal(coordinate, null);
});

test('mapEdgeCoordinate rejects the exclusive far endpoint of a shared edge', () => {
    const geometry = {
        axis: 'y',
        sourceLogical: {x: 0, y: 0, width: 1920, height: 1080},
        targetLogical: {x: 1920, y: 0, width: 1920, height: 1080},
        sourcePhysical: {x: 0, y: 0, width: 600, height: 400},
        targetPhysical: {x: 600, y: 0, width: 500, height: 300},
    };

    assert.equal(mapEdgeCoordinate({coordinate: 810, ...geometry}), null);
    assert.equal(mapEdgeCoordinate({coordinate: Number.NaN, ...geometry}), null);
    assert.ok(mapEdgeCoordinate({coordinate: 809.9, ...geometry}) <= 1079);
});

test('edge push does not warp at the smaller monitor exclusive endpoint', () => {
    const route = routeEdgePush({
        logicalMonitors: [
            {index: 0, x: 0, y: 0, width: 1920, height: 1080},
            {index: 1, x: 1920, y: 0, width: 1920, height: 1080},
        ],
        physicalLayout: [
            {index: 0, physical: {x: 0, y: 0, width: 600, height: 400}},
            {index: 1, physical: {x: 600, y: 0, width: 500, height: 300}},
        ],
        sourceIndex: 0,
        sourceCoordinate: {x: 1919, y: 810},
        delta: {x: 5, y: 0},
    });

    assert.deepEqual(route, {
        action: 'block',
        reason: 'outside-shared-edge',
        direction: 'right',
        targetIndex: 1,
    });
});

test('routeTransition maps a right edge by physical height', () => {
    const result = routeTransition({
        logicalMonitors: [
            {index: 0, x: 0, y: 0, width: 1920, height: 1080},
            {index: 1, x: 1920, y: 0, width: 2560, height: 1440},
        ],
        physicalLayout: [
            {index: 0, physical: {x: 0, y: 0, width: 530, height: 300}},
            {index: 1, physical: {x: 530, y: -50, width: 600, height: 340}},
        ],
        sourceIndex: 0,
        targetIndex: 1,
        sourceCoordinate: {x: 1919, y: 540},
    });

    assert.equal(result.action, 'warp');
    assert.equal(result.direction, 'right');
    assert.equal(result.x, 1922);
    assert.equal(result.y, 200 / 340 * 1440);
});

test('routeTransition retains direction when blocking outside the shared edge', () => {
    const result = routeTransition({
        logicalMonitors: [
            {index: 0, x: 0, y: 0, width: 1920, height: 1080},
            {index: 1, x: 1920, y: 0, width: 1280, height: 720},
        ],
        physicalLayout: [
            {index: 0, physical: {x: 0, y: 0, width: 500, height: 300}},
            {index: 1, physical: {x: 500, y: 50, width: 600, height: 100}},
        ],
        sourceIndex: 0,
        targetIndex: 1,
        sourceCoordinate: {x: 1919, y: 90},
    });

    assert.deepEqual(result, {
        action: 'block',
        reason: 'outside-shared-edge',
        direction: 'right',
    });
});

test('routeTransition blocks logical neighbors that are physically separated', () => {
    const result = routeTransition({
        logicalMonitors: monitors,
        physicalLayout: [
            {index: 4, physical: {x: 0, y: 0, width: 500, height: 300}},
            {index: 8, physical: {x: 600, y: 0, width: 600, height: 340}},
        ],
        sourceIndex: 4,
        targetIndex: 8,
        sourceCoordinate: {x: -1, y: 500},
    });

    assert.deepEqual(result, {
        action: 'block',
        reason: 'not-adjacent',
        direction: 'right',
    });
});

test('ruler interval comparison reports gap and overlap', () => {
    assert.deepEqual(
        compareIntervals({start: 0, end: 300}, {start: 340, end: 600}),
        {gap: 40, overlap: 0},
    );
    assert.deepEqual(
        compareIntervals({start: -50, end: 250}, {start: 100, end: 340}),
        {gap: 0, overlap: 150},
    );
});

test('ruler metrics describe a selected monitor pair in millimetres', () => {
    const metrics = rulerMetrics(
        {x: 0, y: 0, width: 530, height: 300},
        {x: 530, y: -50, width: 600, height: 340},
    );

    assert.deepEqual(metrics.bounds, {x: 0, y: -50, width: 1130, height: 350});
    assert.deepEqual(metrics.delta, {x: 530, y: -50});
    assert.deepEqual(metrics.horizontal, {gap: 0, overlap: 0});
    assert.deepEqual(metrics.vertical, {gap: 0, overlap: 290});
});

test('monitor transform rotates detected and legacy physical dimensions', () => {
    assert.equal(rotationName(1), '90°');
    assert.deepEqual(
        orientDetectedSize({width: 610, height: 350, source: 'edid'}, 1),
        {width: 350, height: 610, source: 'edid'},
    );
    assert.deepEqual(
        alignSizeToLogical({x: 10, y: 20, width: 610, height: 350}, 1440, 2560),
        {x: 10, y: 20, width: 350, height: 610},
    );
});

test('edge push creates the reverse route outside GNOME native overlap', () => {
    const logicalMonitors = [
        {index: 0, x: 0, y: 1480, width: 1920, height: 1080},
        {index: 1, x: 1920, y: 0, width: 1440, height: 2560},
    ];
    const physicalLayout = [
        {
            index: 0,
            physical: {x: -253.5, y: 118.3337, width: 593.5, height: 331.6663},
        },
        {
            index: 1,
            physical: {x: 340, y: -160, width: 350, height: 610},
        },
    ];

    const route = routeEdgePush({
        logicalMonitors,
        physicalLayout,
        sourceIndex: 1,
        sourceCoordinate: {x: 1920, y: 1300},
        delta: {x: -8, y: 0},
    });

    assert.equal(route.action, 'warp');
    assert.equal(route.direction, 'left');
    assert.equal(route.targetIndex, 0);
    assert.equal(route.x, 1918);
    assert.ok(route.y >= 1480 && route.y < 2560);
});

test('edge push pre-triggers before Mutter clamps the pointer at the seam', () => {
    const route = routeEdgePush({
        logicalMonitors: [
            {index: 0, x: 0, y: 1480, width: 1920, height: 1080},
            {index: 1, x: 1920, y: 0, width: 1440, height: 2560},
        ],
        physicalLayout: [
            {index: 0, physical: {x: -253.5, y: 118, width: 593.5, height: 332}},
            {index: 1, physical: {x: 340, y: -160, width: 350, height: 610}},
        ],
        sourceIndex: 0,
        sourceCoordinate: {x: 1908, y: 1500},
        delta: {x: 4, y: 0},
    });

    assert.equal(route.action, 'warp');
    assert.equal(route.direction, 'right');
    assert.equal(route.targetIndex, 1);
});

test('edge push blocks points outside an adjacent pair physical overlap', () => {
    const route = routeEdgePush({
        logicalMonitors: [
            {index: 0, x: 0, y: 1480, width: 1920, height: 1080},
            {index: 1, x: 1920, y: 0, width: 1440, height: 2560},
        ],
        physicalLayout: [
            {index: 0, physical: {x: 0, y: 120, width: 340, height: 190}},
            {index: 1, physical: {x: 340, y: -160, width: 350, height: 610}},
        ],
        sourceIndex: 1,
        sourceCoordinate: {x: 1920, y: 1000},
        delta: {x: -8, y: 0},
    });

    assert.deepEqual(route, {
        action: 'block',
        reason: 'outside-shared-edge',
        direction: 'left',
        targetIndex: 0,
    });
});

test('invalid native transition returns just inside the source edge', () => {
    const rejection = rejectNativeTransition({
        logicalMonitors: [
            {index: 0, x: 0, y: 1480, width: 1920, height: 1080},
            {index: 1, x: 1920, y: 0, width: 1440, height: 2560},
        ],
        sourceIndex: 1,
        targetIndex: 0,
        sourceCoordinate: {x: 1920, y: 900},
    });

    assert.deepEqual(rejection, {
        action: 'warp-back',
        x: 1922,
        y: 900,
        targetIndex: 1,
    });
});

test('rounded boundary coordinate maps back across an enlarged display pair', () => {
    const returnedY = mapEdgeCoordinate({
        coordinate: 1168,
        axis: 'y',
        sourceLogical: {x: 1920, y: 0, width: 1440, height: 2560},
        targetLogical: {x: 0, y: 1480, width: 1920, height: 1080},
        sourcePhysical: {x: 340.008, y: -160, width: 350, height: 610},
        targetPhysical: {
            x: -253.5,
            y: 118.333744,
            width: 593.508,
            height: 331.666256,
        },
    });

    assert.equal(returnedY, 1480);
});

test('post-warp guard holds a reverse route until it enters the enlarged display', () => {
    const logicalMonitors = [
        {index: 0, x: 0, y: 1480, width: 1920, height: 1080},
        {index: 1, x: 1920, y: 0, width: 1440, height: 2560},
    ];
    const decide = coordinate => warpGuardDecision({
        logicalMonitors,
        targetIndex: 0,
        direction: 'left',
        coordinate,
    });

    assert.deepEqual(
        decide({x: 1931, y: 1480}),
        {action: 'restore', reason: 'left-target'},
    );
    assert.deepEqual(
        decide({x: 1918, y: 1480}),
        {action: 'hold', reason: 'near-entry-edge'},
    );
    assert.deepEqual(
        decide({x: 1908, y: 1480}),
        {action: 'release', reason: 'entered-target'},
    );
});

test('edge barriers cover the physical overlap in both directions', () => {
    const specs = edgeBarrierSpecs({
        logicalMonitors: [
            {index: 0, x: 0, y: 1480, width: 1920, height: 1080},
            {index: 1, x: 1920, y: 0, width: 1440, height: 2560},
        ],
        physicalLayout: [
            {
                index: 0,
                physical: {
                    x: -253.5,
                    y: 118.333744,
                    width: 593.508,
                    height: 331.666256,
                },
            },
            {
                index: 1,
                physical: {x: 340.008, y: -160, width: 350, height: 610},
            },
        ],
    });

    assert.equal(specs.length, 2);
    const reverse = specs.find(spec => spec.sourceIndex === 1);
    assert.equal(reverse.mode, 'warp');
    assert.equal(reverse.direction, 'left');
    assert.equal(reverse.x1, 1920);
    assert.equal(reverse.y1, 1168);
    assert.equal(reverse.y2, 2560);
});

test('edge barriers block the native seam outside a shorter physical edge', () => {
    const specs = edgeBarrierSpecs({
        logicalMonitors: [
            {index: 0, x: 0, y: 0, width: 1920, height: 1080},
            {index: 1, x: 1920, y: 0, width: 1920, height: 1080},
        ],
        physicalLayout: [
            {index: 0, physical: {x: 0, y: 0, width: 340, height: 284.3}},
            {index: 1, physical: {x: 340, y: 0, width: 340, height: 190}},
        ],
    });

    const sourceSpecs = specs.filter(spec =>
        spec.sourceIndex === 0 && spec.direction === 'right');
    assert.deepEqual(
        sourceSpecs.map(spec => ({mode: spec.mode, y1: spec.y1, y2: spec.y2})),
        [
            {mode: 'warp', y1: 0, y2: 722},
            {mode: 'block', y1: 721, y2: 1080},
        ],
    );

    const boundary = sourceSpecs[0].rangeEnd;
    assert.deepEqual(barrierActionAtCoordinate(sourceSpecs, {
        sourceIndex: 0,
        direction: 'right',
        coordinate: boundary - 0.001,
    }), {action: 'warp', targetIndex: 1});
    assert.deepEqual(barrierActionAtCoordinate(sourceSpecs, {
        sourceIndex: 0,
        direction: 'right',
        coordinate: boundary,
    }), {action: 'block', targetIndex: 1});
    assert.deepEqual(barrierActionAtCoordinate(sourceSpecs, {
        sourceIndex: 0,
        direction: 'right',
        coordinate: 1080,
    }), {action: 'block', targetIndex: 1});

    const reverseSpecs = specs.filter(spec =>
        spec.sourceIndex === 1 && spec.direction === 'left');
    assert.deepEqual(
        reverseSpecs.map(spec => ({mode: spec.mode, y1: spec.y1, y2: spec.y2})),
        [{mode: 'warp', y1: 0, y2: 1080}],
    );
});

test('fully separated physical monitors block the complete native seam', () => {
    const specs = edgeBarrierSpecs({
        logicalMonitors: [
            {index: 0, x: 0, y: 0, width: 1920, height: 1080},
            {index: 1, x: 1920, y: 0, width: 1920, height: 1080},
        ],
        physicalLayout: [
            {index: 0, physical: {x: 0, y: 0, width: 340, height: 284}},
            {index: 1, physical: {x: 500, y: 0, width: 340, height: 190}},
        ],
    });

    assert.deepEqual(specs.map(spec => ({
        sourceIndex: spec.sourceIndex,
        targetIndex: spec.targetIndex,
        direction: spec.direction,
        mode: spec.mode,
        rangeStart: spec.rangeStart,
        rangeEnd: spec.rangeEnd,
    })), [
        {
            sourceIndex: 0,
            targetIndex: 1,
            direction: 'right',
            mode: 'block',
            rangeStart: 0,
            rangeEnd: 1080,
        },
        {
            sourceIndex: 1,
            targetIndex: 0,
            direction: 'left',
            mode: 'block',
            rangeStart: 0,
            rangeEnd: 1080,
        },
    ]);
});

test('edge push blocks a native seam without a physical neighbor', () => {
    const result = routeEdgePush({
        logicalMonitors: [
            {index: 0, x: 0, y: 0, width: 1920, height: 1080},
            {index: 1, x: 1920, y: 0, width: 1920, height: 1080},
        ],
        physicalLayout: [
            {index: 0, physical: {x: 0, y: 0, width: 340, height: 284}},
            {index: 1, physical: {x: 500, y: 0, width: 340, height: 190}},
        ],
        sourceIndex: 0,
        sourceCoordinate: {x: 1919, y: 540},
        delta: {x: 8, y: 0},
    });

    assert.deepEqual(result, {
        action: 'block',
        reason: 'not-adjacent',
        direction: 'right',
        targetIndex: 1,
    });
});

test('partition barriers merge per direction without merging reverse barriers', () => {
    const geometry = mergedBarrierGeometry([
        {direction: 'right', x1: 1920, x2: 1920, y1: 0, y2: 722},
        {direction: 'right', x1: 1920, x2: 1920, y1: 721, y2: 1080},
        {direction: 'left', x1: 1920, x2: 1920, y1: 0, y2: 1080},
    ]);

    assert.deepEqual(geometry, [
        {
            vertical: true,
            direction: 'right',
            x1: 1920,
            x2: 1920,
            y1: 0,
            y2: 1080,
        },
        {
            vertical: true,
            direction: 'left',
            x1: 1920,
            x2: 1920,
            y1: 0,
            y2: 1080,
        },
    ]);
});

test('top corner guards sit inside each directional source monitor', () => {
    const guards = topCornerBarrierGeometry([
        {
            vertical: true,
            direction: 'right',
            x1: 1920,
            x2: 1920,
            y1: 0,
            y2: 1080,
        },
        {
            vertical: true,
            direction: 'left',
            x1: 1920,
            x2: 1920,
            y1: 0,
            y2: 1080,
        },
    ]);

    assert.deepEqual(guards, [
        {
            vertical: true,
            direction: 'right',
            x1: 1919,
            x2: 1919,
            y1: 0,
            y2: 2,
            cornerGuard: true,
        },
        {
            vertical: true,
            direction: 'left',
            x1: 1921,
            x2: 1921,
            y1: 0,
            y2: 2,
            cornerGuard: true,
        },
    ]);
});

test('native barrier geometry excludes every monitor corner', () => {
    const monitors = [{index: 0, x: 0, y: 0, width: 1920, height: 1080}];
    const geometry = trimBarrierGeometryFromCorners([
        {
            vertical: true,
            direction: 'right',
            x1: 1920,
            x2: 1920,
            y1: 0,
            y2: 1080,
        },
        {
            vertical: false,
            direction: 'down',
            x1: 0,
            x2: 1920,
            y1: 1080,
            y2: 1080,
        },
    ], monitors, 24);

    assert.deepEqual(geometry, [
        {
            vertical: true,
            direction: 'right',
            x1: 1920,
            x2: 1920,
            y1: 24,
            y2: 1056,
        },
        {
            vertical: false,
            direction: 'down',
            x1: 24,
            x2: 1896,
            y1: 1080,
            y2: 1080,
        },
    ]);
});

test('a top blocked interval owns its shared endpoint with a mapped interval', () => {
    const specs = [
        {
            sourceIndex: 0,
            targetIndex: 1,
            direction: 'right',
            mode: 'block',
            rangeStart: 0,
            rangeEnd: 180,
        },
        {
            sourceIndex: 0,
            targetIndex: 1,
            direction: 'right',
            mode: 'warp',
            rangeStart: 180,
            rangeEnd: 540,
        },
    ];

    assert.deepEqual(barrierActionAtCoordinate(specs, {
        sourceIndex: 0,
        direction: 'right',
        coordinate: 180,
    }), {action: 'block', targetIndex: 1});
    assert.deepEqual(barrierActionAtCoordinate(specs, {
        sourceIndex: 0,
        direction: 'right',
        coordinate: 180.001,
    }), {action: 'warp', targetIndex: 1});
});

// Tall outer screens, with a shorter middle screen below the upper passage.
const gapLogical = [
    {index: 0, x: 0, y: 0, width: 1000, height: 1000},
    {index: 1, x: 1000, y: 0, width: 1000, height: 1000},
    {index: 2, x: 2000, y: 0, width: 2000, height: 1000},
];
const gapPhysical = [
    {index: 0, x: 0, y: 0, width: 300, height: 600},
    {index: 1, x: 300, y: 300, width: 600, height: 300},
    {index: 2, x: 900, y: 0, width: 800, height: 600},
];

for (const vertical of [false, true]) {
    const transpose = m => ({...m, x: m.y, y: m.x, width: m.height, height: m.width});
    const logicalMonitors = vertical ? gapLogical.map(transpose) : gapLogical;
    const physicalLayout = vertical ? gapPhysical.map(transpose) : gapPhysical;
    const point = (x, y) => vertical ? {x: y, y: x} : {x, y};
    const direction = vertical ? 'down' : 'right';
    const options = {
        logicalMonitors, physicalLayout, sourceIndex: 0,
        sourceCoordinate: point(999, 250), delta: point(5, 0),
    };
    test(`skip gaps ${direction}: opt-in, nearest screen and preserved physical coordinate`, () => {
        assert.equal(routeEdgePush(options).action, 'block');
        const route = routeEdgePush({...options, skipScreenGaps: true});
        assert.equal(route.action, 'warp');
        assert.equal(route.targetIndex, 2);
        assert.equal(vertical ? route.x : route.y, 250);
        const middle = routeEdgePush({...options, skipScreenGaps: true,
            sourceCoordinate: point(999, 750)});
        assert.equal(middle.targetIndex, 1);
        assert.equal(vertical ? middle.x : middle.y, 500);
        const reverse = routeEdgePush({...options, skipScreenGaps: true,
            sourceIndex: 2, sourceCoordinate: point(2000, 250), delta: point(-5, 0)});
        assert.equal(reverse.targetIndex, 0);
        assert.equal(vertical ? reverse.x : reverse.y, 250);
        const noTarget = routeEdgePush({...options, skipScreenGaps: true,
            sourceCoordinate: point(0, 250), delta: point(-5, 0)});
        assert.equal(noTarget.action, 'ignore');
    });
    test(`skip gaps ${direction}: barriers and native fallback agree on the bypass target`, () => {
        const specs = edgeBarrierSpecs({...options, skipScreenGaps: true});
        for (const [coordinate, targetIndex] of [[250, 2], [500, 1], [750, 1]]) {
            assert.deepEqual(barrierActionAtCoordinate(specs, {
                sourceIndex: 0, direction, coordinate,
            }), {action: 'warp', targetIndex});
            assert.equal(routeEdgePush({...options, skipScreenGaps: true,
                sourceCoordinate: point(999, coordinate)}).targetIndex, targetIndex);
        }
        const fallback = routeTransition({...options, skipScreenGaps: true, targetIndex: 1});
        assert.equal(fallback.action, 'warp');
        assert.equal(fallback.targetIndex, 2);
        const reordered = routeEdgePush({...options, skipScreenGaps: true,
            logicalMonitors: [...logicalMonitors].reverse(),
            sourceCoordinate: point(999, 750)});
        assert.equal(reordered.targetIndex, 1);
    });
}

test('skip gaps does not jump to a screen outside the physical ray', () => {
    const physicalLayout = gapPhysical.map(m => m.index === 2 ? {...m, y: 200} : m);
    const options = {logicalMonitors: gapLogical, physicalLayout, skipScreenGaps: true,
        sourceIndex: 0, sourceCoordinate: {x: 999, y: 250}, delta: {x: 5, y: 0}};
    assert.equal(routeEdgePush(options).action, 'block');
    assert.equal(barrierActionAtCoordinate(edgeBarrierSpecs(options), {
        sourceIndex: 0, direction: 'right', coordinate: 250,
    }).action, 'block');
});
