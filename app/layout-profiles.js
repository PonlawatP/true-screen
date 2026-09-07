function monitorIds(layoutOrIds) {
    const entries = Array.isArray(layoutOrIds)
        ? layoutOrIds
        : layoutOrIds?.monitors;
    if (!Array.isArray(entries))
        return [];

    return entries.map(entry =>
        typeof entry === 'string' ? entry : entry?.id,
    ).filter(id => typeof id === 'string' && id.length > 0);
}

export function monitorIdentityKey(entry) {
    const id = typeof entry === 'string' ? entry : entry?.id;
    if (typeof id !== 'string' || id.length === 0)
        return null;

    const parts = id.split('|');
    if (parts.length < 4)
        return id;

    const [_connector, vendor, product, ...serialParts] = parts;
    const serial = serialParts.join('|');
    return JSON.stringify([vendor, product, serial]);
}

export function monitorSetKey(layoutOrIds) {
    const ids = monitorIds(layoutOrIds)
        .map(monitorIdentityKey)
        .filter(id => id !== null)
        .sort();
    if (ids.length === 0)
        return null;
    return JSON.stringify(ids);
}

export function matchMonitorEntry(entries, current, usedEntries = new Set()) {
    const currentId = typeof current === 'string' ? current : current?.id;
    const available = (entries ?? []).filter(entry => !usedEntries.has(entry));
    const exact = available.find(entry => entry?.id === currentId);
    if (exact)
        return exact;

    const identity = monitorIdentityKey(current);
    return available.find(entry => monitorIdentityKey(entry) === identity) ?? null;
}

export function countAdjustedMonitorPositions(
    savedEntries,
    currentEntries,
    epsilon = 0.000001,
) {
    const usedSavedEntries = new Set();
    let adjusted = 0;
    for (const current of currentEntries ?? []) {
        const saved = matchMonitorEntry(
            savedEntries,
            current,
            usedSavedEntries,
        );
        if (saved)
            usedSavedEntries.add(saved);
        if (saved?.physical && current?.physical &&
            (Math.abs(saved.physical.x - current.physical.x) > epsilon ||
                Math.abs(saved.physical.y - current.physical.y) > epsilon)) {
            adjusted++;
        }
    }
    return adjusted;
}

function profileLayout(layout) {
    if (layout?.schemaVersion !== 1 || !Array.isArray(layout.monitors))
        return null;

    const {profiles: _profiles, ...profile} = layout;
    return profile;
}

export function selectLayout(document, layoutOrIds) {
    const key = monitorSetKey(layoutOrIds);
    if (!key || document?.schemaVersion !== 1)
        return null;

    const savedProfile = profileLayout(document.profiles?.[key]);
    if (savedProfile && monitorSetKey(savedProfile) === key)
        return savedProfile;

    for (const candidate of Object.values(document.profiles ?? {})) {
        const profile = profileLayout(candidate);
        if (profile && monitorSetKey(profile) === key)
            return profile;
    }

    const rootLayout = profileLayout(document);
    return monitorSetKey(rootLayout) === key ? rootLayout : null;
}

export function withRulerOverlay(
    layout,
    rulerOverlay,
    updatedAt = new Date().toISOString(),
) {
    const appliedLayout = profileLayout(layout);
    if (!appliedLayout)
        return null;

    return {
        ...appliedLayout,
        rulerOverlay,
        updatedAt,
    };
}

export function withSavedProfile(document, layout) {
    const activeLayout = profileLayout(layout);
    const activeKey = monitorSetKey(activeLayout);
    if (!activeLayout || !activeKey)
        throw new Error('Cannot save a layout without identified monitors');

    const profiles = {};
    if (document?.schemaVersion === 1) {
        for (const candidate of Object.values(document.profiles ?? {})) {
            const profile = profileLayout(candidate);
            const key = monitorSetKey(profile);
            if (profile && key)
                profiles[key] = profile;
        }

        const previousRoot = profileLayout(document);
        const previousKey = monitorSetKey(previousRoot);
        if (previousRoot && previousKey)
            profiles[previousKey] = previousRoot;
    }

    profiles[activeKey] = activeLayout;
    return {...activeLayout, profiles};
}
