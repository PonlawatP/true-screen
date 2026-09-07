#!/usr/bin/gjs -m

import Gio from 'gi://Gio';

const DBUS_NAME = 'io.plutostudio.TrueScreen.Spike';
const DBUS_PATH = '/io/plutostudio/TrueScreen/Spike';
const DBUS_INTERFACE = 'io.plutostudio.TrueScreen.Spike';

function call(proxy, method, parameters = null) {
    return proxy.call_sync(
        method,
        parameters,
        Gio.DBusCallFlags.NONE,
        3000,
        null,
    ).deepUnpack();
}

const proxy = Gio.DBusProxy.new_for_bus_sync(
    Gio.BusType.SESSION,
    Gio.DBusProxyFlags.NONE,
    null,
    DBUS_NAME,
    DBUS_PATH,
    DBUS_INTERFACE,
    null,
);

const [beforeJson] = call(proxy, 'GetState');
const before = JSON.parse(beforeJson);
if (!before.extensionEnabled)
    throw new Error('Extension reports that it is not enabled');
if (before.monitors.length < 2)
    throw new Error('At least two active monitors are required');

const [warpJson] = call(proxy, 'WarpToNextMonitor');
const warp = JSON.parse(warpJson);
const [afterJson] = call(proxy, 'GetState');
const after = JSON.parse(afterJson);

const errorX = Math.abs(after.pointer.x - warp.destination.x);
const errorY = Math.abs(after.pointer.y - warp.destination.y);
if (errorX > 2 || errorY > 2) {
    throw new Error(
        `Pointer did not reach destination: expected ` +
        `${warp.destination.x},${warp.destination.y}; got ` +
        `${after.pointer.x},${after.pointer.y}`,
    );
}

print(JSON.stringify({
    passed: true,
    sourceIndex: warp.sourceIndex,
    targetIndex: warp.targetIndex,
    before: before.pointer,
    after: after.pointer,
    activeMonitors: after.monitors.length,
    observedMotionEvents: after.motionEvents,
}, null, 2));
