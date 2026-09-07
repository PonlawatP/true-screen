import assert from 'node:assert/strict';
import test from 'node:test';

import {
    activateProfile,
    monitorSetKey,
    selectProfile,
} from '../extension/true-screen@plutostudio.io/profile-activation.js';

function layout(monitors, name) {
    return {
        schemaVersion: 1,
        enabled: true,
        name,
        monitors,
    };
}

const builtIn1 = 'eDP-1|CMN|0x1521|0x00000000';
const builtIn2 = 'eDP-2|CMN|0x1521|0x00000000';
const dell = 'DP-9|DEL|DELL S2718D|8R33926O00QS';
const samsung = 'HDMI-1|SAM|LS24C33xG|H9TW800692';

test('extension selects an inactive exact monitor-set profile at boot', () => {
    const home = layout([{index: 0, id: builtIn1}], 'home');
    const work = layout([
        {index: 0, id: builtIn2},
        {index: 1, id: samsung},
        {index: 2, id: dell},
    ], 'work');
    const document = {
        ...home,
        profiles: {
            [monitorSetKey(home)]: home,
            [monitorSetKey(work)]: work,
        },
    };

    assert.equal(selectProfile(document, [builtIn2, samsung, dell])?.name, 'work');
});

test('activation survives connector changes and remaps enumeration indices', () => {
    const saved = layout([
        {index: 0, id: builtIn1, physical: {x: 0, y: 200}},
        {index: 1, id: dell, physical: {x: 500, y: 0}},
    ], 'saved');
    saved.rulerOverlay = {enabled: true, firstIndex: 0, secondIndex: 1};
    const activated = activateProfile(saved, [
        {index: 8, id: dell, connector: 'DP-9'},
        {index: 3, id: builtIn2, connector: 'eDP-2'},
    ]);

    assert.deepEqual(activated.monitors.map(monitor => monitor.index), [8, 3]);
    assert.deepEqual(activated.monitors.map(monitor => monitor.physical), [
        {x: 500, y: 0},
        {x: 0, y: 200},
    ]);
    assert.deepEqual(activated.rulerOverlay, {
        enabled: true,
        firstIndex: 3,
        secondIndex: 8,
    });
});

test('activation auto-aligns an overlapping third monitor from live geometry', () => {
    const saved = layout([
        {
            index: 0,
            id: builtIn1,
            physical: {x: 0, y: 0, width: 300, height: 200},
        },
        {
            index: 1,
            id: samsung,
            physical: {x: 300, y: 0, width: 500, height: 280},
        },
        {
            index: 2,
            id: dell,
            physical: {x: 300, y: 0, width: 600, height: 340},
        },
    ], 'overlapping');

    const activated = activateProfile(saved, [
        {
            index: 0,
            id: builtIn1,
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        },
        {
            index: 1,
            id: samsung,
            x: 1920,
            y: 0,
            width: 1920,
            height: 1080,
        },
        {
            index: 2,
            id: dell,
            x: 3840,
            y: 0,
            width: 2560,
            height: 1440,
        },
    ]);

    assert.deepEqual(activated.monitors.map(monitor => monitor.physical.x), [
        0,
        300,
        800,
    ]);
});

test('activation uses vertical live placement when repairing overlap', () => {
    const saved = layout([
        {
            index: 0,
            id: builtIn1,
            physical: {x: 0, y: 0, width: 300, height: 200},
        },
        {
            index: 1,
            id: samsung,
            physical: {x: 0, y: 0, width: 500, height: 280},
        },
    ], 'vertical overlap');

    const activated = activateProfile(saved, [
        {
            index: 0,
            id: builtIn1,
            x: 0,
            y: 1080,
            width: 1920,
            height: 1080,
        },
        {
            index: 1,
            id: samsung,
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        },
    ]);

    assert.deepEqual(activated.monitors.map(monitor => monitor.physical.y), [
        0,
        -280,
    ]);
});

test('activation fails safe when no profile matches the connected set', () => {
    const home = layout([{index: 0, id: builtIn1}], 'home');
    assert.equal(activateProfile(home, [
        {index: 0, id: builtIn2},
        {index: 1, id: samsung},
    ]), null);
});

test('legacy identity-free root layouts remain usable by index', () => {
    const legacy = layout([
        {index: 0, physical: {x: 0, y: 0}},
        {index: 1, physical: {x: 500, y: 0}},
    ], 'legacy');
    const activated = activateProfile(legacy, [
        {index: 0, id: 'virtual-1'},
        {index: 1, id: 'virtual-2'},
    ]);

    assert.equal(activated?.name, 'legacy');
    assert.deepEqual(activated.monitors.map(monitor => monitor.index), [0, 1]);
});
