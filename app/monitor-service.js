import Gio from 'gi://Gio';

import {matchMonitorEntry, selectLayout} from './layout-profiles.js';
import {resolveLayoutOverlapsInReferenceOrder} from './monitor-layout-geometry.js';
import {
    alignSizeToLogical,
    orientDetectedSize,
    rotationName,
} from './monitor-transform.js';

const DISPLAY_CONFIG_NAME = 'org.gnome.Mutter.DisplayConfig';
const DISPLAY_CONFIG_PATH = '/org/gnome/Mutter/DisplayConfig';

function specId(spec) {
    return spec.join('|');
}

function sysfsConnectorName(connector) {
    if (connector.startsWith('HDMI-'))
        return connector.replace('HDMI-', 'HDMI-A-');
    return connector;
}

function readEdidSize(connector) {
    const drm = Gio.File.new_for_path('/sys/class/drm');
    const suffix = `-${sysfsConnectorName(connector)}`;
    try {
        const enumerator = drm.enumerate_children(
            'standard::name',
            Gio.FileQueryInfoFlags.NONE,
            null,
        );
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            const name = info.get_name();
            if (!name.endsWith(suffix))
                continue;

            const edid = drm.get_child(name).get_child('edid');
            const [ok, contents] = edid.load_contents(null);
            if (!ok || contents.length < 23)
                return null;

            const widthCm = contents[21];
            const heightCm = contents[22];
            if (widthCm > 0 && heightCm > 0) {
                return {
                    width: widthCm * 10,
                    height: heightCm * 10,
                    source: 'edid',
                };
            }
            return null;
        }
    } catch (error) {
        console.debug(`[True Screen] EDID read failed for ${connector}: ${error.message}`);
    }
    return null;
}

function sizeFromDisplayName(displayName, pixelWidth, pixelHeight) {
    const match = displayName?.match(/([0-9]+(?:\.[0-9]+)?)\"/);
    if (!match)
        return null;

    const diagonalMm = Number.parseFloat(match[1]) * 25.4;
    const pixelDiagonal = Math.hypot(pixelWidth, pixelHeight);
    return {
        width: diagonalMm * pixelWidth / pixelDiagonal,
        height: diagonalMm * pixelHeight / pixelDiagonal,
        source: 'display-name',
    };
}

function currentMode(monitor) {
    return monitor[1].find(mode => mode[6]['is-current'] === true) ?? monitor[1][0];
}

export function getMonitors(existingLayout = null) {
    const result = Gio.DBus.session.call_sync(
        DISPLAY_CONFIG_NAME,
        DISPLAY_CONFIG_PATH,
        DISPLAY_CONFIG_NAME,
        'GetCurrentState',
        null,
        null,
        Gio.DBusCallFlags.NONE,
        -1,
        null,
    ).recursiveUnpack();

    const physicalMonitors = result[1];
    const logicalMonitors = result[2];
    const byId = new Map(physicalMonitors.map(monitor => [specId(monitor[0]), monitor]));
    const currentIds = logicalMonitors.map(logical => specId(logical[5][0]));
    const selectedLayout = selectLayout(existingLayout, currentIds);
    const savedMonitors = selectedLayout?.monitors ?? [];
    const usedSavedMonitors = new Set();

    const models = logicalMonitors.map((logical, index) => {
        const [x, y, scale, transform, primary, specs] = logical;
        const spec = specs[0];
        const monitor = byId.get(specId(spec));
        const mode = currentMode(monitor);
        let pixelWidth = mode[1];
        let pixelHeight = mode[2];
        let logicalWidth = pixelWidth / scale;
        let logicalHeight = pixelHeight / scale;
        if (transform % 2 === 1) {
            [logicalWidth, logicalHeight] = [logicalHeight, logicalWidth];
        }

        const properties = monitor[2];
        const connector = spec[0];
        const displayName = properties['display-name'] ?? connector;
        const rawDetectedSize = readEdidSize(connector) ??
            sizeFromDisplayName(displayName, pixelWidth, pixelHeight) ?? {
                width: pixelWidth / scale * 0.264583,
                height: pixelHeight / scale * 0.264583,
                source: 'fallback-96dpi',
            };
        const detectedSize = orientDetectedSize(rawDetectedSize, transform);
        const id = specId(spec);
        const saved = matchMonitorEntry(savedMonitors, id, usedSavedMonitors);
        if (saved)
            usedSavedMonitors.add(saved);
        const savedPhysical = saved?.physical
            ? alignSizeToLogical(saved.physical, logicalWidth, logicalHeight)
            : null;

        return {
            index,
            id,
            connector,
            displayName,
            primary,
            scale,
            transform,
            rotation: rotationName(transform),
            resolution: `${pixelWidth}×${pixelHeight}`,
            logical: {
                x,
                y,
                width: logicalWidth,
                height: logicalHeight,
            },
            physical: savedPhysical ?? {
                x: 0,
                y: 0,
                width: detectedSize.width,
                height: detectedSize.height,
            },
            sizeSource: saved?.sizeSource ?? detectedSize.source,
        };
    });

    const primary = models.find(monitor => monitor.primary) ?? models[0];
    const minLogicalX = Math.min(...models.map(monitor => monitor.logical.x));
    const minLogicalY = Math.min(...models.map(monitor => monitor.logical.y));
    const mmPerLogicalPixel = primary.physical.width / primary.logical.width;
    for (const model of models) {
        if (matchMonitorEntry(savedMonitors, model.id))
            continue;
        model.physical.x = (model.logical.x - minLogicalX) * mmPerLogicalPixel;
        model.physical.y = (model.logical.y - minLogicalY) * mmPerLogicalPixel;
    }

    const resolvedPhysical = resolveLayoutOverlapsInReferenceOrder(
        models.map(model => model.physical),
        models.map(model => model.logical),
    );
    models.forEach((model, index) => {
        model.physical.x = resolvedPhysical[index].x;
        model.physical.y = resolvedPhysical[index].y;
    });

    return models;
}

export function serializeLayout(monitors, enabled, rulerOverlay = null, skipScreenGaps = false) {
    return {
        schemaVersion: 1,
        enabled,
        skipScreenGaps: skipScreenGaps === true,
        rulerOverlay,
        updatedAt: new Date().toISOString(),
        monitors: monitors.map(monitor => ({
            index: monitor.index,
            id: monitor.id,
            connector: monitor.connector,
            transform: monitor.transform,
            rotation: monitor.rotation,
            physical: {...monitor.physical},
            sizeSource: monitor.sizeSource,
        })),
    };
}
