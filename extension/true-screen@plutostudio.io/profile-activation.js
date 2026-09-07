function monitorId(entry) {
    return typeof entry === 'string' ? entry : entry?.id;
}

export function monitorIdentityKey(entry) {
    const id = monitorId(entry);
    if (typeof id !== 'string' || id.length === 0)
        return null;

    const parts = id.split('|');
    if (parts.length < 4)
        return id;

    const [_connector, vendor, product, ...serialParts] = parts;
    return JSON.stringify([vendor, product, serialParts.join('|')]);
}

export function monitorSetKey(layoutOrIds) {
    const entries = Array.isArray(layoutOrIds)
        ? layoutOrIds
        : layoutOrIds?.monitors;
    if (!Array.isArray(entries))
        return null;

    const identities = entries
        .map(monitorIdentityKey)
        .filter(identity => identity !== null)
        .sort();
    return identities.length > 0 ? JSON.stringify(identities) : null;
}

function profileLayout(layout) {
    if (layout?.schemaVersion !== 1 || !Array.isArray(layout.monitors))
        return null;
    const {profiles: _profiles, ...profile} = layout;
    return profile;
}

export function selectProfile(document, liveMonitors) {
    const key = monitorSetKey(liveMonitors);
    if (!key || document?.schemaVersion !== 1)
        return null;

    const direct = profileLayout(document.profiles?.[key]);
    if (direct && monitorSetKey(direct) === key)
        return direct;

    for (const candidate of Object.values(document.profiles ?? {})) {
        const profile = profileLayout(candidate);
        if (profile && monitorSetKey(profile) === key)
            return profile;
    }

    const root = profileLayout(document);
    return root && monitorSetKey(root) === key ? root : null;
}

function matchingEntry(entries, liveMonitor, used) {
    const available = entries.filter(entry => !used.has(entry));
    const exact = available.find(entry => entry.id === liveMonitor.id);
    if (exact)
        return exact;

    const identity = monitorIdentityKey(liveMonitor);
    return available.find(entry => monitorIdentityKey(entry) === identity) ?? null;
}

function legacyRoot(document, liveMonitors) {
    const root = profileLayout(document);
    if (!root || root.monitors.length !== liveMonitors.length ||
        root.monitors.some(monitor => typeof monitor.id === 'string'))
        return null;
    return root;
}

const GEOMETRY_EPSILON = 0.000001;

function overlaps(first, second) {
    return first.x < second.x + second.width - GEOMETRY_EPSILON &&
        first.x + first.width > second.x + GEOMETRY_EPSILON &&
        first.y < second.y + second.height - GEOMETRY_EPSILON &&
        first.y + first.height > second.y + GEOMETRY_EPSILON;
}

function hasRect(rect) {
    return rect &&
        [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
        rect.width > 0 && rect.height > 0;
}

function separateRect(rect, obstacle, liveRect, liveObstacle) {
    const candidates = [
        {...rect, x: obstacle.x - rect.width},
        {...rect, x: obstacle.x + obstacle.width},
        {...rect, y: obstacle.y - rect.height},
        {...rect, y: obstacle.y + obstacle.height},
    ];

    if (hasRect(liveRect) && hasRect(liveObstacle)) {
        const deltaX = liveRect.x + liveRect.width / 2 -
            liveObstacle.x - liveObstacle.width / 2;
        const deltaY = liveRect.y + liveRect.height / 2 -
            liveObstacle.y - liveObstacle.height / 2;
        if (Math.abs(deltaX) >= Math.abs(deltaY) && deltaX !== 0)
            return deltaX < 0 ? candidates[0] : candidates[1];
        if (deltaY !== 0)
            return deltaY < 0 ? candidates[2] : candidates[3];
    }

    candidates.sort((first, second) =>
        (first.x - rect.x) ** 2 + (first.y - rect.y) ** 2 -
        ((second.x - rect.x) ** 2 + (second.y - rect.y) ** 2),
    );
    return candidates[0];
}

function autoAlignOverlaps(monitors, liveMonitors) {
    const liveByIndex = new Map(liveMonitors.map(monitor => [
        monitor.index,
        monitor,
    ]));
    const resolved = [];
    return monitors.map(monitor => {
        if (!hasRect(monitor.physical)) {
            resolved.push(monitor);
            return monitor;
        }

        let physical = {...monitor.physical};
        const maxPasses = Math.max(1, resolved.length * 4);
        for (let pass = 0; pass < maxPasses; pass++) {
            const obstacle = resolved.find(candidate =>
                hasRect(candidate.physical) &&
                overlaps(physical, candidate.physical),
            );
            if (!obstacle)
                break;
            physical = separateRect(
                physical,
                obstacle.physical,
                liveByIndex.get(monitor.index),
                liveByIndex.get(obstacle.index),
            );
        }

        const aligned = {...monitor, physical};
        resolved.push(aligned);
        return aligned;
    });
}

export function activateProfile(document, liveMonitors) {
    if (!Array.isArray(liveMonitors) || liveMonitors.length === 0)
        return null;

    const selected = selectProfile(document, liveMonitors) ??
        legacyRoot(document, liveMonitors);
    if (!selected || selected.monitors.length !== liveMonitors.length)
        return null;

    const used = new Set();
    const indexMap = new Map();
    const legacy = selected.monitors.every(monitor => !monitor.id);
    const monitors = [];
    for (const [position, liveMonitor] of liveMonitors.entries()) {
        const saved = legacy
            ? selected.monitors.find(monitor =>
                monitor.index === liveMonitor.index,
            ) ?? selected.monitors[position]
            : matchingEntry(selected.monitors, liveMonitor, used);
        if (!saved)
            return null;
        used.add(saved);
        indexMap.set(saved.index, liveMonitor.index);
        monitors.push({
            ...saved,
            index: liveMonitor.index,
            id: liveMonitor.id ?? saved.id,
            connector: liveMonitor.connector ?? saved.connector,
        });
    }

    const ruler = selected.rulerOverlay;
    const remapIndex = index => indexMap.has(index) ? indexMap.get(index) : null;
    return {
        ...selected,
        monitors: autoAlignOverlaps(monitors, liveMonitors),
        rulerOverlay: ruler ? {
            ...ruler,
            firstIndex: remapIndex(ruler.firstIndex),
            secondIndex: remapIndex(ruler.secondIndex),
        } : ruler,
    };
}
