import assert from 'node:assert/strict';
import test from 'node:test';

import {
    countAdjustedMonitorPositions,
    matchMonitorEntry,
    monitorIdentityKey,
    monitorSetKey,
    selectLayout,
    withRulerOverlay,
    withSavedProfile,
} from '../app/layout-profiles.js';

function layout(ids, name) {
    return {
        schemaVersion: 1,
        enabled: true,
        name,
        monitors: ids.map(id => ({id, physical: {x: 0, y: 0}})),
    };
}

test('monitor set key is stable across monitor enumeration order', () => {
    assert.equal(
        monitorSetKey(['display-2', 'display-1']),
        monitorSetKey(['display-1', 'display-2']),
    );
});

test('monitor identity remains stable when Mutter changes the connector', () => {
    const edp1 = 'eDP-1|CMN|0x1521|0x00000000';
    const edp2 = 'eDP-2|CMN|0x1521|0x00000000';

    assert.equal(monitorIdentityKey(edp1), monitorIdentityKey(edp2));
    assert.equal(monitorSetKey([edp1]), monitorSetKey([edp2]));
});

test('matching prefers an exact connector before stable monitor identity', () => {
    const hdmi = {id: 'HDMI-1|ACR|SA240Y|0x00900518'};
    const displayPort = {id: 'DP-9|ACR|SA240Y|0x00900518'};
    const entries = [displayPort, hdmi];

    assert.equal(matchMonitorEntry(entries, hdmi.id), hdmi);
    assert.equal(
        matchMonitorEntry([displayPort], hdmi.id),
        displayPort,
    );
});

test('counts every monitor position corrected during profile restoration', () => {
    const saved = [
        {
            id: 'display-1',
            physical: {x: 0, y: 0},
        },
        {
            id: 'display-2',
            physical: {x: 300, y: 0},
        },
        {
            id: 'display-3',
            physical: {x: 300, y: 0},
        },
    ];
    const restored = [
        {
            id: 'display-1',
            physical: {x: 0, y: 0},
        },
        {
            id: 'display-2',
            physical: {x: 340, y: 0},
        },
        {
            id: 'display-3',
            physical: {x: 870, y: -10},
        },
    ];

    assert.equal(countAdjustedMonitorPositions(saved, restored), 2);
});

test('ignores sub-pixel restoration noise when detecting corrected positions', () => {
    assert.equal(countAdjustedMonitorPositions([
        {id: 'display-1', physical: {x: 10, y: 20}},
    ], [
        {id: 'display-1', physical: {x: 10.0000001, y: 19.9999999}},
    ]), 0);
});

test('selectLayout only restores an exact monitor set', () => {
    const twoDisplays = layout(['display-1', 'display-2'], 'two');

    assert.equal(selectLayout(twoDisplays, ['display-2', 'display-1'])?.name, 'two');
    assert.equal(selectLayout(twoDisplays, ['display-1', 'display-2', 'display-3']), null);
});

test('saving different monitor sets preserves and selects separate profiles', () => {
    const twoDisplays = layout(['display-1', 'display-2'], 'two');
    const threeDisplays = layout(
        ['display-1', 'display-2', 'display-3'],
        'three',
    );

    const afterThree = withSavedProfile(twoDisplays, threeDisplays);

    assert.equal(selectLayout(afterThree, ['display-1', 'display-2'])?.name, 'two');
    assert.equal(
        selectLayout(afterThree, ['display-3', 'display-2', 'display-1'])?.name,
        'three',
    );
    assert.equal(afterThree.name, 'three');
    assert.equal(Object.keys(afterThree.profiles).length, 2);
});

test('saving a profile replaces only the matching monitor set', () => {
    const original = withSavedProfile(null, layout(['display-1'], 'old'));
    const updated = withSavedProfile(original, layout(['display-1'], 'new'));

    assert.equal(selectLayout(updated, ['display-1'])?.name, 'new');
    assert.equal(Object.keys(updated.profiles).length, 1);
});

test('legacy connector-specific profile keys migrate without losing layouts', () => {
    const oldId = 'eDP-1|CMN|0x1521|0x00000000';
    const newId = 'eDP-2|CMN|0x1521|0x00000000';
    const oldLayout = layout([oldId], 'old connector');
    const document = {
        ...oldLayout,
        profiles: {
            [JSON.stringify([oldId])]: oldLayout,
        },
    };

    assert.equal(selectLayout(document, [newId])?.name, 'old connector');
    const migrated = withSavedProfile(document, layout([newId], 'new connector'));
    assert.equal(Object.keys(migrated.profiles).length, 1);
    assert.equal(selectLayout(migrated, [oldId])?.name, 'new connector');
});

test('updating the ruler preserves the applied layout and cursor setting', () => {
    const applied = layout(['display-1', 'display-2'], 'applied');
    applied.monitors[0].physical.x = 120;
    const rulerOverlay = {
        enabled: true,
        firstIndex: 0,
        secondIndex: 1,
    };

    const updated = withRulerOverlay(
        applied,
        rulerOverlay,
        '2026-08-19T00:00:00.000Z',
    );

    assert.equal(updated.enabled, true);
    assert.equal(updated.monitors[0].physical.x, 120);
    assert.deepEqual(updated.rulerOverlay, rulerOverlay);
    assert.equal(updated.updatedAt, '2026-08-19T00:00:00.000Z');
});

test('updating the ruler cannot turn an unapplied draft into a profile', () => {
    assert.equal(withRulerOverlay(null, {
        enabled: false,
        firstIndex: 0,
        secondIndex: 1,
    }), null);
});

test('gap preference stays with its monitor profile and survives immediate ruler changes', () => {
    const first = {...layout(['a', 'b'], 'first'), skipScreenGaps: true};
    const second = {...layout(['a'], 'second'), skipScreenGaps: false};
    const saved = withSavedProfile(withSavedProfile(null, first), second);
    assert.equal(selectLayout(saved, ['a', 'b']).skipScreenGaps, true);
    assert.equal(selectLayout(saved, ['a']).skipScreenGaps, false);
    assert.equal(withRulerOverlay(first, {enabled: true}).skipScreenGaps, true);
});
