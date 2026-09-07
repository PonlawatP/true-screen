export function axisInterval(rect, axis) {
    if (axis === 'x')
        return {start: rect.x, end: rect.x + rect.width};
    if (axis === 'y')
        return {start: rect.y, end: rect.y + rect.height};
    throw new Error(`Unsupported ruler axis: ${axis}`);
}

export function compareIntervals(first, second) {
    const overlap = Math.max(
        0,
        Math.min(first.end, second.end) - Math.max(first.start, second.start),
    );
    const gap = overlap > 0
        ? 0
        : Math.max(first.start, second.start) - Math.min(first.end, second.end);

    return {gap: Math.max(0, gap), overlap};
}

export function rulerMetrics(firstRect, secondRect) {
    const firstX = axisInterval(firstRect, 'x');
    const firstY = axisInterval(firstRect, 'y');
    const secondX = axisInterval(secondRect, 'x');
    const secondY = axisInterval(secondRect, 'y');
    const horizontal = compareIntervals(firstX, secondX);
    const vertical = compareIntervals(firstY, secondY);

    return {
        bounds: {
            x: Math.min(firstX.start, secondX.start),
            y: Math.min(firstY.start, secondY.start),
            width: Math.max(firstX.end, secondX.end) - Math.min(firstX.start, secondX.start),
            height: Math.max(firstY.end, secondY.end) - Math.min(firstY.start, secondY.start),
        },
        delta: {
            x: secondRect.x - firstRect.x,
            y: secondRect.y - firstRect.y,
        },
        horizontal,
        vertical,
    };
}
