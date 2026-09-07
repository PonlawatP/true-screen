import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

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

    expect(Main.layoutManager.monitors.length === 2,
        `Expected 2 headless monitors, got ${Main.layoutManager.monitors.length}`);

    const extension = Main.extensionManager.lookup(UUID);
    expect(extension, `Extension ${UUID} was not discovered`);
    expect(extension.stateObj, `Extension ${UUID} was not enabled`);

    const instance = extension.stateObj;
    const before = JSON.parse(instance.GetState());
    expect(before.extensionEnabled, 'Extension did not report enabled state');

    const seat = Clutter.get_default_backend().get_default_seat();
    virtualPointer = seat.create_virtual_device(
        Clutter.InputDeviceType.POINTER_DEVICE,
    );
    virtualPointer.notify_absolute_motion(
        GLib.get_monotonic_time(),
        100,
        100,
    );
    await Scripting.waitLeisure();

    const afterMotion = JSON.parse(instance.GetState());
    expect(afterMotion.motionEvents > before.motionEvents,
        'The extension did not observe injected pointer motion');

    const warp = JSON.parse(instance.WarpToNextMonitor());
    const [pointerX, pointerY] = global.get_pointer();
    expectNear(pointerX, warp.destination.x, 'Pointer X after warp');
    expectNear(pointerY, warp.destination.y, 'Pointer Y after warp');

    const developmentBefore = JSON.parse(instance.GetDevelopmentState());
    instance.ReloadImplementation();
    let developmentAfter = developmentBefore;
    for (let attempt = 0; attempt < 40; attempt++) {
        await delay(25);
        developmentAfter = JSON.parse(instance.GetDevelopmentState());
        if (!developmentAfter.reloadInProgress &&
            developmentAfter.reloadSerial > developmentBefore.reloadSerial)
            break;
    }
    expect(developmentAfter.loaded && developmentAfter.lastReloadError === null,
        `Hot reload failed: ${developmentAfter.lastReloadError}`);
    expect(developmentAfter.reloadSerial > developmentBefore.reloadSerial,
        'Hot reload serial did not advance');
    expect(JSON.parse(instance.GetState()).extensionEnabled,
        'Implementation was not enabled after hot reload');

    const result = {
        passed: true,
        activeMonitors: afterMotion.monitors.length,
        observedMotionEvents: afterMotion.motionEvents,
        targetIndex: warp.targetIndex,
        destination: warp.destination,
        pointer: {x: pointerX, y: pointerY},
        hotReload: {
            before: developmentBefore.reloadSerial,
            after: developmentAfter.reloadSerial,
            implementationVersion: developmentAfter.implementationVersion,
        },
    };
    const resultJson = JSON.stringify(result);
    const resultFile = GLib.getenv('TRUE_SCREEN_RESULT_FILE');
    if (resultFile)
        GLib.file_set_contents(resultFile, resultJson);

    console.log(`[True Screen Test] ${resultJson}`);
}

export function finish() {}
