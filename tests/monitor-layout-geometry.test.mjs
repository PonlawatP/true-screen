import assert from 'node:assert/strict';
import test from 'node:test';

import {
    constrainRectToConnectedLayout,
    constrainRectToLayout,
    layoutIsConnected,
    rectanglesOverlap,
    rectanglesTouch,
    resizeRectFromCorner,
    resizeRectFromHandle,
    resolveLayoutOverlaps,
    resolveLayoutOverlapsInReferenceOrder,
} from '../app/monitor-layout-geometry.js';

const obstacle = {x: 100, y: 0, width: 100, height: 100};

test('touching monitor edges do not count as overlap', () => {
    assert.equal(rectanglesOverlap(
        {x: 0, y: 0, width: 100, height: 100},
        obstacle,
    ), false);
});

test('dragging into a monitor stops flush against the entered edge', () => {
    const constrained = constrainRectToLayout(
        {x: 30, y: 10, width: 80, height: 80},
        [obstacle],
        {x: 20, y: 10, width: 80, height: 80},
    );

    assert.deepEqual(constrained, {x: 20, y: 10, width: 80, height: 80});
});

test('continued dragging cannot tunnel through a monitor', () => {
    const constrained = constrainRectToLayout(
        {x: 250, y: 10, width: 80, height: 80},
        [obstacle],
        {x: 20, y: 10, width: 80, height: 80},
    );

    assert.equal(constrained.x, 20);
});

test('restored overlapping monitors move to their nearest touching edge', () => {
    const resolved = resolveLayoutOverlaps([
        {x: 0, y: 0, width: 600, height: 340},
        {x: 508, y: 0, width: 600, height: 340},
        {x: 1016, y: 0, width: 600, height: 340},
    ]);

    assert.deepEqual(resolved.map(rect => rect.x), [0, 600, 1200]);
    assert.equal(rectanglesOverlap(resolved[0], resolved[1]), false);
    assert.equal(rectanglesOverlap(resolved[1], resolved[2]), false);
});

test('restoration cannot accept a connected rectangle that still overlaps', () => {
    const resolved = resolveLayoutOverlaps([
        {
            x: -260.4713706669621,
            y: 247.80328857591317,
            width: 600.4713706669621,
            height: 335.5575306668317,
        },
        {
            x: 340,
            y: -29.74777811790443,
            width: 826.1316596196029,
            height: 467.6216941243036,
        },
        {x: 340, y: 0, width: 350, height: 610},
    ]);

    for (let first = 0; first < resolved.length; first++) {
        for (let second = first + 1; second < resolved.length; second++) {
            assert.equal(rectanglesOverlap(
                resolved[first],
                resolved[second],
            ), false);
        }
    }
    assert.equal(layoutIsConnected(resolved), true);
});

test('restoration follows logical topology instead of enumeration order', () => {
    const resolved = resolveLayoutOverlapsInReferenceOrder([
        {x: -260, y: 248, width: 600, height: 336},
        {x: 340, y: -30, width: 826, height: 468},
        {x: 340, y: 0, width: 350, height: 610},
    ], [
        {x: 0, y: 1480, width: 1920, height: 1080},
        {x: 3360, y: 511, width: 1920, height: 1080},
        {x: 1920, y: 0, width: 1440, height: 2560},
    ]);

    assert.deepEqual(resolved.map(rect => ({x: rect.x, y: rect.y})), [
        {x: -260, y: 248},
        {x: 690, y: -30},
        {x: 340, y: 0},
    ]);
    assert.equal(layoutIsConnected(resolved), true);
});

test('all four corners resize while keeping the opposite corner anchored', () => {
    const start = {x: 10, y: 20, width: 200, height: 100};
    const cases = [
        ['top-left', -40, -20, {x: -30, y: 0, right: 210, bottom: 120}],
        ['top-right', 40, -20, {x: 10, y: 0, right: 250, bottom: 120}],
        ['bottom-left', -40, 20, {x: -30, y: 20, right: 210, bottom: 140}],
        ['bottom-right', 40, 20, {x: 10, y: 20, right: 250, bottom: 140}],
    ];

    for (const [corner, deltaX, deltaY, expected] of cases) {
        const resized = resizeRectFromCorner(
            start,
            corner,
            deltaX,
            deltaY,
            60,
        );
        assert.deepEqual({
            x: resized.x,
            y: resized.y,
            right: resized.x + resized.width,
            bottom: resized.y + resized.height,
        }, expected);
    }
});

test('all four edges resize proportionally around the opposite axis centre', () => {
    const start = {x: 10, y: 20, width: 200, height: 100};
    const cases = [
        ['left', -40, 0, {x: -30, y: 10, width: 240, height: 120}],
        ['right', 40, 0, {x: 10, y: 10, width: 240, height: 120}],
        ['top', 0, -20, {x: -10, y: 0, width: 240, height: 120}],
        ['bottom', 0, 20, {x: -10, y: 20, width: 240, height: 120}],
    ];

    for (const [handle, deltaX, deltaY, expected] of cases) {
        assert.deepEqual(
            resizeRectFromHandle(start, handle, deltaX, deltaY, 60),
            expected,
        );
    }
});

test('edge resize respects the minimum width and keeps its anchor', () => {
    const start = {x: 10, y: 20, width: 200, height: 100};

    assert.deepEqual(
        resizeRectFromHandle(start, 'left', 500, 0, 60),
        {x: 150, y: 55, width: 60, height: 30},
    );
    assert.deepEqual(
        resizeRectFromHandle(start, 'top', 0, 500, 60),
        {x: 80, y: 90, width: 60, height: 30},
    );
});

test('resize keeps growing and translates away after reaching another monitor', () => {
    const start = {x: 0, y: 0, width: 100, height: 100};
    const firstGrowth = constrainRectToLayout(
        resizeRectFromCorner(start, 'bottom-right', 50, 50, 60),
        [obstacle],
        start,
    );
    const continuedGrowth = constrainRectToLayout(
        resizeRectFromCorner(start, 'bottom-right', 100, 100, 60),
        [obstacle],
        firstGrowth,
    );

    assert.deepEqual(firstGrowth, {x: -50, y: 0, width: 150, height: 150});
    assert.deepEqual(continuedGrowth, {x: -100, y: 0, width: 200, height: 200});
});

test('shrinking an attached monitor keeps its resized edge connected', () => {
    const start = {x: 0, y: 0, width: 100, height: 100};
    const resized = constrainRectToConnectedLayout(
        resizeRectFromCorner(start, 'bottom-right', -50, -50, 20),
        [obstacle],
        start,
    );

    assert.deepEqual(resized, {x: 50, y: 0, width: 50, height: 50});
    assert.equal(rectanglesTouch(resized, obstacle), true);
});

test('moving away from the layout stays attached to the nearest edge', () => {
    const attached = constrainRectToConnectedLayout(
        {x: -500, y: 40, width: 80, height: 80},
        [obstacle],
        {x: 20, y: 10, width: 80, height: 80},
    );

    assert.deepEqual(attached, {x: 20, y: 40, width: 80, height: 80});
    assert.equal(rectanglesTouch(attached, obstacle), true);
});

test('restored monitor gaps are closed into one connected layout', () => {
    const resolved = resolveLayoutOverlaps([
        {x: 0, y: 0, width: 100, height: 100},
        {x: 300, y: 25, width: 100, height: 100},
        {x: 700, y: 50, width: 100, height: 100},
    ]);

    assert.deepEqual(resolved.map(rect => rect.x), [0, 100, 200]);
    assert.equal(rectanglesTouch(resolved[0], resolved[1]), true);
    assert.equal(rectanglesTouch(resolved[1], resolved[2]), true);
    assert.equal(layoutIsConnected(resolved), true);
});

test('moving a bridge monitor cannot split the remaining layout', () => {
    const left = {x: 0, y: 0, width: 100, height: 100};
    const bridge = {x: 100, y: 0, width: 100, height: 100};
    const right = {x: 200, y: 0, width: 100, height: 100};
    const constrained = constrainRectToConnectedLayout(
        {x: 0, y: -100, width: 100, height: 100},
        [left, right],
        bridge,
    );

    assert.equal(constrained.x, bridge.x);
    assert.equal(rectanglesTouch(left, constrained), true);
    assert.equal(rectanglesTouch(constrained, right), true);
    assert.equal(layoutIsConnected([left, constrained, right]), true);
});
