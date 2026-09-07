/**
 * Pure geometry helpers shared by the GNOME extension and Node.js tests.
 * Rectangles use a top-left origin and half-open right/bottom edges.
 */

export function containsPoint(rect, x, y) {
    return x >= rect.x &&
        x < rect.x + rect.width &&
        y >= rect.y &&
        y < rect.y + rect.height;
}

export function findMonitor(monitors, x, y) {
    return monitors.find(monitor => containsPoint(monitor, x, y)) ?? null;
}

export function nextMonitor(monitors, currentIndex) {
    if (monitors.length === 0)
        return null;

    const position = monitors.findIndex(monitor => monitor.index === currentIndex);
    return monitors[position < 0 ? 0 : (position + 1) % monitors.length];
}

export function warpGuardDecision({
    logicalMonitors,
    targetIndex,
    direction,
    coordinate,
    releaseDistance = 12,
}) {
    const target = logicalMonitors.find(monitor => monitor.index === targetIndex);
    if (!target)
        return {action: 'release', reason: 'missing-target'};

    const current = findMonitor(logicalMonitors, coordinate.x, coordinate.y);
    if (current?.index !== targetIndex)
        return {action: 'restore', reason: 'left-target'};

    let enteredTarget = false;
    if (direction === 'left')
        enteredTarget = coordinate.x <= target.x + target.width - releaseDistance;
    else if (direction === 'right')
        enteredTarget = coordinate.x >= target.x + releaseDistance;
    else if (direction === 'up')
        enteredTarget = coordinate.y <= target.y + target.height - releaseDistance;
    else if (direction === 'down')
        enteredTarget = coordinate.y >= target.y + releaseDistance;
    else
        return {action: 'release', reason: 'missing-direction'};

    return enteredTarget
        ? {action: 'release', reason: 'entered-target'}
        : {action: 'hold', reason: 'near-entry-edge'};
}

export function centerOf(rect) {
    return {
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
    };
}

export function clampPointToMonitor(rect, x, y) {
    if (!rect || !Number.isFinite(x) || !Number.isFinite(y) ||
        !Number.isFinite(rect.x) || !Number.isFinite(rect.y) ||
        !Number.isFinite(rect.width) || !Number.isFinite(rect.height) ||
        rect.width <= 0 || rect.height <= 0)
        return null;

    return {
        x: clamp(Math.round(x), rect.x, rect.x + rect.width - 1),
        y: clamp(Math.round(y), rect.y, rect.y + rect.height - 1),
    };
}

export function mapEdgeCoordinate({
    coordinate,
    sourceLogical,
    targetLogical,
    sourcePhysical,
    targetPhysical,
    axis,
    edgeEpsilon = 0.001,
}) {
    const vertical = axis === 'y';
    if (!vertical && axis !== 'x')
        throw new Error(`Unsupported axis: ${axis}`);

    const logicalOrigin = vertical ? sourceLogical.y : sourceLogical.x;
    const logicalLength = vertical ? sourceLogical.height : sourceLogical.width;
    const physicalOrigin = vertical ? sourcePhysical.y : sourcePhysical.x;
    const physicalLength = vertical ? sourcePhysical.height : sourcePhysical.width;
    const targetPhysicalOrigin = vertical ? targetPhysical.y : targetPhysical.x;
    const targetPhysicalLength = vertical ? targetPhysical.height : targetPhysical.width;
    const targetLogicalOrigin = vertical ? targetLogical.y : targetLogical.x;
    const targetLogicalLength = vertical ? targetLogical.height : targetLogical.width;

    if (![coordinate, logicalOrigin, logicalLength, physicalOrigin,
        physicalLength, targetPhysicalOrigin, targetPhysicalLength,
        targetLogicalOrigin, targetLogicalLength].every(Number.isFinite))
        return null;

    if (logicalLength <= 0 || physicalLength <= 0 ||
        targetPhysicalLength <= 0 || targetLogicalLength <= 0)
        throw new Error('Rectangle dimensions must be positive');

    const sourceRatio = (coordinate - logicalOrigin) / logicalLength;
    const physicalCoordinate = physicalOrigin + sourceRatio * physicalLength;
    const targetRatio = (physicalCoordinate - targetPhysicalOrigin) /
        targetPhysicalLength;

    // Monitor rectangles are half-open. The far end of the shared edge is
    // therefore not a valid target pixel; accepting ratio === 1 maps to
    // targetLogicalOrigin + targetLogicalLength, outside the target monitor.
    if (targetRatio < -edgeEpsilon || targetRatio >= 1)
        return null;

    const clampedRatio = Math.max(0, targetRatio);
    return Math.min(
        targetLogicalOrigin + targetLogicalLength - 1,
        targetLogicalOrigin + clampedRatio * targetLogicalLength,
    );
}

function physicalFor(layout, index) {
    const entry = layout.find(monitor => monitor.index === index);
    if (!entry)
        return null;
    return entry.physical ?? entry;
}

function edgeDirection(sourceLogical, coordinate, delta, threshold) {
    const horizontal = Math.abs(delta.x) >= Math.abs(delta.y);
    if (horizontal && delta.x < 0 &&
        coordinate.x <= sourceLogical.x + threshold)
        return 'left';
    if (horizontal && delta.x > 0 &&
        coordinate.x >= sourceLogical.x + sourceLogical.width - 1 - threshold)
        return 'right';
    if (!horizontal && delta.y < 0 &&
        coordinate.y <= sourceLogical.y + threshold)
        return 'up';
    if (!horizontal && delta.y > 0 &&
        coordinate.y >= sourceLogical.y + sourceLogical.height - 1 - threshold)
        return 'down';
    return null;
}

function physicallyAdjacent(source, target, direction, tolerance) {
    if (direction === 'left')
        return Math.abs(source.x - (target.x + target.width)) <= tolerance;
    if (direction === 'right')
        return Math.abs(source.x + source.width - target.x) <= tolerance;
    if (direction === 'up')
        return Math.abs(source.y - (target.y + target.height)) <= tolerance;
    return Math.abs(source.y + source.height - target.y) <= tolerance;
}

// Sort forward-facing screens by distance. Mapping the perpendicular axis
// later discards screens that do not intersect the pointer's physical ray.
function routingTargets(logicalMonitors, physicalLayout, sourceLogical,
    direction, tolerance, skipScreenGaps) {
    const source = physicalFor(physicalLayout, sourceLogical.index);
    return logicalMonitors.filter(target => target.index !== sourceLogical.index)
        .map(logical => {
            const physical = physicalFor(physicalLayout, logical.index);
            if (!physical)
                return null;
            const distance = direction === 'right'
                ? physical.x - (source.x + source.width)
                : direction === 'left'
                    ? source.x - (physical.x + physical.width)
                    : direction === 'down'
                        ? physical.y - (source.y + source.height)
                        : source.y - (physical.y + physical.height);
            if (skipScreenGaps ? distance < -tolerance : Math.abs(distance) > tolerance)
                return null;
            return {logical, physical, distance: Math.max(0, distance)};
        }).filter(Boolean)
        .sort((a, b) => a.distance - b.distance || a.logical.index - b.logical.index);
}

export function mappedPhysicalEdge(sourceEntry, targetEntry, tolerance = 8) {
    const source = sourceEntry.physical ?? sourceEntry;
    const target = targetEntry.physical ?? targetEntry;
    const sourceRight = source.x + source.width;
    const sourceBottom = source.y + source.height;
    const targetRight = target.x + target.width;
    const targetBottom = target.y + target.height;
    let edge;
    let axis;
    if (Math.abs(sourceRight - target.x) <= tolerance) {
        edge = 'right';
        axis = 'y';
    } else if (Math.abs(source.x - targetRight) <= tolerance) {
        edge = 'left';
        axis = 'y';
    } else if (Math.abs(sourceBottom - target.y) <= tolerance) {
        edge = 'bottom';
        axis = 'x';
    } else if (Math.abs(source.y - targetBottom) <= tolerance) {
        edge = 'top';
        axis = 'x';
    } else {
        return null;
    }

    const sourceStart = axis === 'x' ? source.x : source.y;
    const sourceEnd = sourceStart + (axis === 'x' ? source.width : source.height);
    const targetStart = axis === 'x' ? target.x : target.y;
    const targetEnd = targetStart + (axis === 'x' ? target.width : target.height);
    const start = Math.max(sourceStart, targetStart);
    const end = Math.min(sourceEnd, targetEnd);
    return end > start ? {edge, axis, start, end} : null;
}

export function adjacentPhysicalMonitors(source, entries, tolerance = 8) {
    return entries.filter(candidate => candidate !== source &&
        mappedPhysicalEdge(source, candidate, tolerance) !== null);
}

function mappedLogicalCoordinate(physicalCoordinate, logical, physical, axis) {
    const vertical = axis === 'y';
    const physicalOrigin = vertical ? physical.y : physical.x;
    const physicalLength = vertical ? physical.height : physical.width;
    const logicalOrigin = vertical ? logical.y : logical.x;
    const logicalLength = vertical ? logical.height : logical.width;
    return logicalOrigin +
        (physicalCoordinate - physicalOrigin) / physicalLength * logicalLength;
}

function edgeInterval(rect, direction) {
    const vertical = direction === 'left' || direction === 'right';
    const start = vertical ? rect.y : rect.x;
    return {
        start,
        end: start + (vertical ? rect.height : rect.width),
    };
}

function uncoveredIntervals(interval, covers) {
    const result = [];
    let cursor = interval.start;
    const sortedCovers = covers
        .map(cover => ({
            start: Math.max(interval.start, cover.start),
            end: Math.min(interval.end, cover.end),
        }))
        .filter(cover => cover.end > cover.start)
        .sort((left, right) => left.start - right.start);

    for (const cover of sortedCovers) {
        if (cover.start > cursor)
            result.push({start: cursor, end: cover.start});
        cursor = Math.max(cursor, cover.end);
        if (cursor >= interval.end)
            break;
    }
    if (cursor < interval.end)
        result.push({start: cursor, end: interval.end});
    return result;
}

function appendBarrierSpec(specs, {
    sourceLogical,
    targetIndex,
    direction,
    start,
    end,
    mode,
}) {
    // Pointer coordinates are fractional but Meta.Barrier endpoints are
    // integers. Round outward so adjacent segments overlap instead of leaving
    // a sub-pixel gap; routing still uses the original half-open ranges below.
    const integerStart = Math.floor(start);
    const integerEnd = Math.ceil(end);
    if (integerEnd < integerStart)
        return;

    const vertical = direction === 'left' || direction === 'right';
    const spec = {
        sourceIndex: sourceLogical.index,
        targetIndex,
        direction,
        mode,
        rangeStart: start,
        rangeEnd: end,
    };
    if (vertical) {
        const x = direction === 'left'
            ? sourceLogical.x
            : sourceLogical.x + sourceLogical.width;
        spec.x1 = x;
        spec.x2 = x;
        spec.y1 = integerStart;
        spec.y2 = integerEnd;
    } else {
        const y = direction === 'up'
            ? sourceLogical.y
            : sourceLogical.y + sourceLogical.height;
        spec.x1 = integerStart;
        spec.x2 = integerEnd;
        spec.y1 = y;
        spec.y2 = y;
    }
    specs.push(spec);
}

export function barrierActionAtCoordinate(specs, {
    sourceIndex,
    direction,
    coordinate,
}) {
    if (!Number.isFinite(coordinate))
        return null;

    const candidates = specs.filter(spec =>
        spec.sourceIndex === sourceIndex &&
        spec.direction === direction);
    // Blocking owns shared partition endpoints on either side of a mapped
    // interval. Checking it first keeps both top-block→warp and
    // warp→bottom-block boundaries fenced.
    const blocked = candidates.find(spec =>
        spec.mode === 'block' &&
        coordinate >= spec.rangeStart &&
        coordinate <= spec.rangeEnd);
    if (blocked)
        return {action: 'block', targetIndex: blocked.targetIndex};

    const mapped = candidates.find(spec =>
        spec.mode === 'warp' &&
        coordinate >= spec.rangeStart &&
        coordinate < spec.rangeEnd);
    return mapped
        ? {action: 'warp', targetIndex: mapped.targetIndex}
        : null;
}

export function mergedBarrierGeometry(specs) {
    const lines = new Map();
    for (const spec of specs) {
        const vertical = spec.x1 === spec.x2;
        const horizontal = spec.y1 === spec.y2;
        if (vertical === horizontal)
            continue;

        const fixed = vertical ? spec.x1 : spec.y1;
        const start = vertical
            ? Math.min(spec.y1, spec.y2)
            : Math.min(spec.x1, spec.x2);
        const end = vertical
            ? Math.max(spec.y1, spec.y2)
            : Math.max(spec.x1, spec.x2);
        if (![fixed, start, end].every(Number.isFinite) || end < start)
            continue;

        if (!['left', 'right', 'up', 'down'].includes(spec.direction))
            continue;
        const key = `${vertical ? 'vertical' : 'horizontal'}:${fixed}:` +
            spec.direction;
        if (!lines.has(key))
            lines.set(key, {
                vertical,
                fixed,
                direction: spec.direction,
                intervals: [],
            });
        lines.get(key).intervals.push({start, end});
    }

    const geometry = [];
    for (const line of lines.values()) {
        const intervals = line.intervals.sort((left, right) =>
            left.start - right.start || left.end - right.end);
        for (const interval of intervals) {
            const previous = geometry.at(-1);
            const sameLine = previous &&
                previous.vertical === line.vertical &&
                previous.direction === line.direction &&
                (line.vertical ? previous.x1 : previous.y1) === line.fixed;
            const previousEnd = previous
                ? (line.vertical ? previous.y2 : previous.x2)
                : -Infinity;
            if (sameLine && interval.start <= previousEnd) {
                if (line.vertical)
                    previous.y2 = Math.max(previous.y2, interval.end);
                else
                    previous.x2 = Math.max(previous.x2, interval.end);
                continue;
            }

            geometry.push(line.vertical ? {
                vertical: true,
                direction: line.direction,
                x1: line.fixed,
                x2: line.fixed,
                y1: interval.start,
                y2: interval.end,
            } : {
                vertical: false,
                direction: line.direction,
                x1: interval.start,
                x2: interval.end,
                y1: line.fixed,
                y2: line.fixed,
            });
        }
    }
    return geometry;
}

export function topCornerBarrierGeometry(geometry, inset = 1, length = 2) {
    if (![inset, length].every(Number.isFinite) || inset <= 0 || length <= 0)
        throw new Error('Corner barrier dimensions must be positive');

    const guards = [];
    for (const spec of geometry) {
        if (spec.vertical && spec.y1 === 0) {
            const x = spec.direction === 'right'
                ? spec.x1 - inset
                : spec.x1 + inset;
            if (x >= 0) {
                guards.push({
                    vertical: true,
                    direction: spec.direction,
                    x1: x,
                    x2: x,
                    y1: 0,
                    y2: length,
                    cornerGuard: true,
                });
            }
        } else if (!spec.vertical && spec.x1 === 0) {
            const y = spec.direction === 'down'
                ? spec.y1 - inset
                : spec.y1 + inset;
            if (y >= 0) {
                guards.push({
                    vertical: false,
                    direction: spec.direction,
                    x1: 0,
                    x2: length,
                    y1: y,
                    y2: y,
                    cornerGuard: true,
                });
            }
        }
    }
    return guards;
}

export function trimBarrierGeometryFromCorners(
    geometry,
    logicalMonitors,
    inset = 24,
) {
    if (!Number.isFinite(inset) || inset < 0)
        throw new Error('Corner exclusion inset must be non-negative');

    return geometry.map(spec => {
        const trimmed = {...spec};
        for (const monitor of logicalMonitors) {
            const vertical = spec.vertical;
            const fixed = vertical ? spec.x1 : spec.y1;
            const sourceEdge = spec.direction === 'right'
                ? monitor.x + monitor.width
                : spec.direction === 'left'
                    ? monitor.x
                    : spec.direction === 'down'
                        ? monitor.y + monitor.height
                        : monitor.y;
            if (Math.abs(fixed - sourceEdge) > 0.001)
                continue;

            if (vertical) {
                if (Math.abs(spec.y1 - monitor.y) <= 0.001)
                    trimmed.y1 = Math.max(trimmed.y1, monitor.y + inset);
                if (Math.abs(spec.y2 - (monitor.y + monitor.height)) <= 0.001)
                    trimmed.y2 = Math.min(
                        trimmed.y2,
                        monitor.y + monitor.height - inset,
                    );
            } else {
                if (Math.abs(spec.x1 - monitor.x) <= 0.001)
                    trimmed.x1 = Math.max(trimmed.x1, monitor.x + inset);
                if (Math.abs(spec.x2 - (monitor.x + monitor.width)) <= 0.001)
                    trimmed.x2 = Math.min(
                        trimmed.x2,
                        monitor.x + monitor.width - inset,
                    );
            }
        }
        return trimmed;
    }).filter(spec => spec.vertical
        ? spec.y2 > spec.y1
        : spec.x2 > spec.x1);
}

export function edgeBarrierSpecs({
    logicalMonitors,
    physicalLayout,
    adjacencyTolerance = 8,
    skipScreenGaps = false,
}) {
    const specs = [];
    for (const sourceLogical of logicalMonitors) {
        const sourcePhysical = physicalFor(physicalLayout, sourceLogical.index);
        if (!sourcePhysical)
            continue;
        for (const direction of ['left', 'right', 'up', 'down']) {
            const covered = [];
            for (const {logical: targetLogical, physical: targetPhysical} of
                routingTargets(logicalMonitors, physicalLayout, sourceLogical,
                    direction, adjacencyTolerance, skipScreenGaps === true)) {
                const vertical = direction === 'left' || direction === 'right';
                const sourceInterval = edgeInterval(sourcePhysical, direction);
                const targetInterval = edgeInterval(targetPhysical, direction);
                const overlap = {
                    start: Math.max(sourceInterval.start, targetInterval.start),
                    end: Math.min(sourceInterval.end, targetInterval.end),
                };
                if (overlap.end <= overlap.start)
                    continue;
                // A nearer screen owns its interval; only empty space can be skipped.
                for (const interval of uncoveredIntervals(overlap, covered)) {
                    appendBarrierSpec(specs, {
                        sourceLogical,
                        targetIndex: targetLogical.index,
                        direction,
                        start: mappedLogicalCoordinate(interval.start,
                            sourceLogical, sourcePhysical, vertical ? 'y' : 'x'),
                        end: mappedLogicalCoordinate(interval.end,
                            sourceLogical, sourcePhysical, vertical ? 'y' : 'x'),
                        mode: 'warp',
                    });
                }
                covered.push(overlap);
            }
        }
    }

    // A mapped edge can be shorter than Mutter's native logical seam. Cover
    // every unmapped part with a non-releasing barrier so the pointer can cross
    // only where the applied physical layout defines a shared edge. This also
    // blocks a complete native seam when the physical monitors are separated.
    for (const sourceLogical of logicalMonitors) {
        for (const direction of ['left', 'right', 'up', 'down']) {
            const mappedSpecs = specs.filter(spec =>
                spec.mode === 'warp' &&
                spec.sourceIndex === sourceLogical.index &&
                spec.direction === direction);
            const mappedIntervals = mappedSpecs.map(spec => ({
                start: spec.rangeStart,
                end: spec.rangeEnd,
            }));
            for (const targetLogical of logicalMonitors) {
                if (targetLogical.index === sourceLogical.index ||
                    !physicallyAdjacent(
                        sourceLogical,
                        targetLogical,
                        direction,
                        1,
                    ))
                    continue;

                const sourceInterval = edgeInterval(sourceLogical, direction);
                const targetInterval = edgeInterval(targetLogical, direction);
                const nativeInterval = {
                    start: Math.max(sourceInterval.start, targetInterval.start),
                    end: Math.min(sourceInterval.end, targetInterval.end),
                };
                if (nativeInterval.end <= nativeInterval.start)
                    continue;

                for (const interval of uncoveredIntervals(
                    nativeInterval,
                    mappedIntervals,
                )) {
                    appendBarrierSpec(specs, {
                        sourceLogical,
                        targetIndex: targetLogical.index,
                        direction,
                        start: interval.start,
                        end: interval.end,
                        mode: 'block',
                    });
                }
            }
        }
    }
    return specs;
}

export function routeEdgePush({
    logicalMonitors,
    physicalLayout,
    sourceIndex,
    sourceCoordinate,
    delta,
    edgeThreshold = 12,
    adjacencyTolerance = 8,
    inset = 2,
    skipScreenGaps = false,
}) {
    const sourceLogical = logicalMonitors.find(m => m.index === sourceIndex);
    const sourcePhysical = physicalFor(physicalLayout, sourceIndex);
    if (!sourceLogical || !sourcePhysical)
        return {action: 'ignore', reason: 'missing-source'};

    const direction = edgeDirection(
        sourceLogical,
        sourceCoordinate,
        delta,
        edgeThreshold,
    );
    if (!direction)
        return {action: 'ignore', reason: 'not-pushing-edge'};

    const axis = direction === 'left' || direction === 'right' ? 'y' : 'x';
    const coordinate = axis === 'y' ? sourceCoordinate.y : sourceCoordinate.x;
    let adjacentTarget = null;
    for (const {logical: targetLogical, physical: targetPhysical} of
        routingTargets(logicalMonitors, physicalLayout, sourceLogical,
            direction, adjacencyTolerance, skipScreenGaps === true)) {
        adjacentTarget ??= targetLogical;

        const mapped = mapEdgeCoordinate({
            coordinate,
            sourceLogical,
            targetLogical,
            sourcePhysical,
            targetPhysical,
            axis,
        });
        if (mapped === null)
            continue;

        const destination = {
            action: 'warp',
            direction,
            targetIndex: targetLogical.index,
        };
        if (direction === 'left') {
            destination.x = targetLogical.x + targetLogical.width - inset;
            destination.y = mapped;
        } else if (direction === 'right') {
            destination.x = targetLogical.x + inset;
            destination.y = mapped;
        } else if (direction === 'up') {
            destination.x = mapped;
            destination.y = targetLogical.y + targetLogical.height - inset;
        } else {
            destination.x = mapped;
            destination.y = targetLogical.y + inset;
        }
        return destination;
    }

    if (adjacentTarget) {
        return {
            action: 'block',
            reason: 'outside-shared-edge',
            direction,
            targetIndex: adjacentTarget.index,
        };
    }

    const nativeTarget = logicalMonitors.find(targetLogical => {
        if (targetLogical.index === sourceIndex || !physicallyAdjacent(
            sourceLogical,
            targetLogical,
            direction,
            1,
        ))
            return false;

        const sourceInterval = edgeInterval(sourceLogical, direction);
        const targetInterval = edgeInterval(targetLogical, direction);
        return coordinate >= Math.max(sourceInterval.start, targetInterval.start) &&
            coordinate < Math.min(sourceInterval.end, targetInterval.end);
    });
    if (nativeTarget) {
        return {
            action: 'block',
            reason: 'not-adjacent',
            direction,
            targetIndex: nativeTarget.index,
        };
    }

    return {action: 'ignore', reason: 'no-physical-neighbor'};
}

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

export function rejectNativeTransition({
    logicalMonitors,
    sourceIndex,
    targetIndex,
    sourceCoordinate,
    inset = 2,
}) {
    const source = logicalMonitors.find(monitor => monitor.index === sourceIndex);
    const target = logicalMonitors.find(monitor => monitor.index === targetIndex);
    if (!source || !target)
        return {action: 'ignore', reason: 'missing-monitor'};

    let x = clamp(
        sourceCoordinate.x,
        source.x + inset,
        source.x + source.width - inset,
    );
    let y = clamp(
        sourceCoordinate.y,
        source.y + inset,
        source.y + source.height - inset,
    );
    const sourceCenter = centerOf(source);
    const targetCenter = centerOf(target);
    const deltaX = targetCenter.x - sourceCenter.x;
    const deltaY = targetCenter.y - sourceCenter.y;

    if (Math.abs(deltaX) >= Math.abs(deltaY))
        x = deltaX < 0 ? source.x + inset : source.x + source.width - inset;
    else
        y = deltaY < 0 ? source.y + inset : source.y + source.height - inset;

    return {
        action: 'warp-back',
        x,
        y,
        targetIndex: sourceIndex,
    };
}

export function routeTransition({
    logicalMonitors,
    physicalLayout,
    sourceIndex,
    targetIndex,
    sourceCoordinate,
    adjacencyTolerance = 8,
    inset = 2,
    skipScreenGaps = false,
}) {
    const sourceLogical = logicalMonitors.find(m => m.index === sourceIndex);
    const targetLogical = logicalMonitors.find(m => m.index === targetIndex);
    const sourcePhysical = physicalFor(physicalLayout, sourceIndex);
    const targetPhysical = physicalFor(physicalLayout, targetIndex);

    if (!sourceLogical || !targetLogical || !sourcePhysical || !targetPhysical)
        return {action: 'ignore', reason: 'missing-monitor'};

    if (skipScreenGaps === true) {
        const direction = ['left', 'right', 'up', 'down'].find(candidate =>
            physicallyAdjacent(sourceLogical, targetLogical, candidate, 1));
        if (direction) {
            const delta = {
                x: direction === 'left' ? -1 : direction === 'right' ? 1 : 0,
                y: direction === 'up' ? -1 : direction === 'down' ? 1 : 0,
            };
            return routeEdgePush({
                logicalMonitors, physicalLayout, sourceIndex, sourceCoordinate,
                delta, edgeThreshold: Infinity, adjacencyTolerance, inset,
                skipScreenGaps: true,
            });
        }
    }

    const sourceRight = sourcePhysical.x + sourcePhysical.width;
    const sourceBottom = sourcePhysical.y + sourcePhysical.height;
    const targetRight = targetPhysical.x + targetPhysical.width;
    const targetBottom = targetPhysical.y + targetPhysical.height;

    let direction = null;
    let axis = null;
    if (Math.abs(sourceRight - targetPhysical.x) <= adjacencyTolerance) {
        direction = 'right';
        axis = 'y';
    } else if (Math.abs(sourcePhysical.x - targetRight) <= adjacencyTolerance) {
        direction = 'left';
        axis = 'y';
    } else if (Math.abs(sourceBottom - targetPhysical.y) <= adjacencyTolerance) {
        direction = 'down';
        axis = 'x';
    } else if (Math.abs(sourcePhysical.y - targetBottom) <= adjacencyTolerance) {
        direction = 'up';
        axis = 'x';
    } else {
        const direction = ['left', 'right', 'up', 'down'].find(candidate =>
            physicallyAdjacent(
                sourceLogical,
                targetLogical,
                candidate,
                1,
            ));
        return {action: 'block', reason: 'not-adjacent', direction};
    }

    const coordinate = axis === 'y' ? sourceCoordinate.y : sourceCoordinate.x;
    const mapped = mapEdgeCoordinate({
        coordinate,
        sourceLogical,
        targetLogical,
        sourcePhysical,
        targetPhysical,
        axis,
    });
    if (mapped === null)
        return {action: 'block', reason: 'outside-shared-edge', direction};

    const destination = {action: 'warp', direction};
    if (direction === 'right') {
        destination.x = targetLogical.x + inset;
        destination.y = mapped;
    } else if (direction === 'left') {
        destination.x = targetLogical.x + targetLogical.width - inset;
        destination.y = mapped;
    } else if (direction === 'down') {
        destination.x = mapped;
        destination.y = targetLogical.y + inset;
    } else {
        destination.x = mapped;
        destination.y = targetLogical.y + targetLogical.height - inset;
    }

    return destination;
}
