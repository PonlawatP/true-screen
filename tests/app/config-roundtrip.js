#!/usr/bin/gjs -m

import GLib from 'gi://GLib';

import {configPath, loadLayout, saveLayout} from '../../app/config-store.js';
import {selectLayout} from '../../app/layout-profiles.js';
import {getMonitors, serializeLayout} from '../../app/monitor-service.js';

const expectedRoot = GLib.getenv('XDG_CONFIG_HOME');
if (!expectedRoot)
    throw new Error('This test requires an isolated XDG_CONFIG_HOME');

const monitors = getMonitors();
if (monitors.length < 1)
    throw new Error('Mutter returned no active monitors');

const rulerOverlay = {
    enabled: monitors.length >= 2,
    firstIndex: monitors[0].index,
    secondIndex: monitors[1]?.index ?? null,
};
const writtenPath = saveLayout(serializeLayout(monitors, true, rulerOverlay));
if (!writtenPath.startsWith(expectedRoot))
    throw new Error(`Refusing to test outside ${expectedRoot}: ${writtenPath}`);

const loaded = loadLayout();
if (!loaded || loaded.schemaVersion !== 1)
    throw new Error('Saved layout did not load with schema version 1');
const selected = selectLayout(loaded, monitors);
if (!selected?.enabled)
    throw new Error('Enabled flag was not preserved');
if (selected.monitors.length !== monitors.length)
    throw new Error('Monitor count changed during config round trip');
if (selected.rulerOverlay?.firstIndex !== rulerOverlay.firstIndex ||
    selected.rulerOverlay?.secondIndex !== rulerOverlay.secondIndex)
    throw new Error('Desktop ruler pair was not preserved');
if (Object.keys(loaded.profiles ?? {}).length !== 1)
    throw new Error('Saved layout was not recorded as a monitor-set profile');

print(JSON.stringify({
    passed: true,
    configPath: configPath(),
    monitors: selected.monitors.length,
}));

saveLayout(serializeLayout(monitors, true, rulerOverlay, true));
if (selectLayout(loadLayout(), monitors)?.skipScreenGaps !== true)
    throw new Error('Skip screen gaps was not preserved');
saveLayout(serializeLayout(monitors, true, rulerOverlay));
if (selectLayout(loadLayout(), monitors)?.skipScreenGaps !== false)
    throw new Error('Skip screen gaps must default to disabled');
