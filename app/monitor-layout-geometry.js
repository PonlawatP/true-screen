const EPSILON = 0.000001;

export function rectanglesOverlap(first, second) {
    return first.x < second.x + second.width - EPSILON &&
        first.x + first.width > second.x + EPSILON &&
        first.y < second.y + second.height - EPSILON &&
        first.y + first.height > second.y + EPSILON;
}

function rangesOverlap(firstStart, firstSize, secondStart, secondSize) {
    return firstStart < secondStart + secondSize - EPSILON &&
        firstStart + firstSize > secondStart + EPSILON;
}

export function rectanglesTouch(first, second) {
    const verticalOverlap = rangesOverlap(
        first.y,
        first.height,
        second.y,
        second.height,
    );
    const horizontalOverlap = rangesOverlap(
        first.x,
        first.width,
        second.x,
        second.width,
    );
    return verticalOverlap && (
        Math.abs(first.x + first.width - second.x) <= EPSILON ||
        Math.abs(first.x - second.x - second.width) <= EPSILON
    ) || horizontalOverlap && (
        Math.abs(first.y + first.height - second.y) <= EPSILON ||
        Math.abs(first.y - second.y - second.height) <= EPSILON
    );
}

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function attachmentCandidates(rect, obstacle) {
    const verticalOverlap = Math.min(
        40,
        Math.min(rect.height, obstacle.height) * 0.25,
    );
    const horizontalOverlap = Math.min(
        40,
        Math.min(rect.width, obstacle.width) * 0.25,
    );
    const attachedY = clamp(
        rect.y,
        obstacle.y - rect.height + verticalOverlap,
        obstacle.y + obstacle.height - verticalOverlap,
    );
    const attachedX = clamp(
        rect.x,
        obstacle.x - rect.width + horizontalOverlap,
        obstacle.x + obstacle.width - horizontalOverlap,
    );
    return [
        {...rect, x: obstacle.x - rect.width, y: attachedY},
        {...rect, x: obstacle.x + obstacle.width, y: attachedY},
        {...rect, x: attachedX, y: obstacle.y - rect.height},
        {...rect, x: attachedX, y: obstacle.y + obstacle.height},
    ];
}

export function layoutIsConnected(rects) {
    if (rects.length < 2)
        return true;
    const visited = new Set([0]);
    const pending = [0];
    while (pending.length > 0) {
        const current = pending.pop();
        rects.forEach((rect, index) => {
            if (!visited.has(index) && rectanglesTouch(rects[current], rect)) {
                visited.add(index);
                pending.push(index);
            }
        });
    }
    return visited.size === rects.length;
}

function crossesObstacle(rect, obstacle, previous) {
    if (!previous)
        return false;

    const verticalOverlap = rangesOverlap(
        rect.y,
        rect.height,
        obstacle.y,
        obstacle.height,
    );
    if (verticalOverlap &&
        previous.x + previous.width <= obstacle.x + EPSILON &&
        rect.x + rect.width > obstacle.x + EPSILON)
        return true;
    if (verticalOverlap &&
        previous.x >= obstacle.x + obstacle.width - EPSILON &&
        rect.x < obstacle.x + obstacle.width - EPSILON)
        return true;

    const horizontalOverlap = rangesOverlap(
        rect.x,
        rect.width,
        obstacle.x,
        obstacle.width,
    );
    if (horizontalOverlap &&
        previous.y + previous.height <= obstacle.y + EPSILON &&
        rect.y + rect.height > obstacle.y + EPSILON)
        return true;
    return horizontalOverlap &&
        previous.y >= obstacle.y + obstacle.height - EPSILON &&
        rect.y < obstacle.y + obstacle.height - EPSILON;
}

function separationCandidates(rect, obstacle, previous) {
    const candidates = [
        {axis: 'x', value: obstacle.x - rect.width},
        {axis: 'x', value: obstacle.x + obstacle.width},
        {axis: 'y', value: obstacle.y - rect.height},
        {axis: 'y', value: obstacle.y + obstacle.height},
    ];
    if (!previous)
        return candidates;

    const enteredFrom = [];
    if (previous.x + previous.width <= obstacle.x + EPSILON)
        enteredFrom.push(candidates[0]);
    if (previous.x >= obstacle.x + obstacle.width - EPSILON)
        enteredFrom.push(candidates[1]);
    if (previous.y + previous.height <= obstacle.y + EPSILON)
        enteredFrom.push(candidates[2]);
    if (previous.y >= obstacle.y + obstacle.height - EPSILON)
        enteredFrom.push(candidates[3]);
    return enteredFrom.length > 0 ? enteredFrom : candidates;
}

function applyNearestSeparation(rect, obstacle, previous) {
    const candidates = separationCandidates(rect, obstacle, previous);
    candidates.sort((first, second) =>
        Math.abs(rect[first.axis] - first.value) -
        Math.abs(rect[second.axis] - second.value),
    );
    const nearest = candidates[0];
    return {...rect, [nearest.axis]: nearest.value};
}

export function constrainRectToLayout(rect, obstacles, previous = null) {
    let constrained = {...rect};
    const maxPasses = Math.max(1, obstacles.length * 4);
    for (let pass = 0; pass < maxPasses; pass++) {
        const obstacle = obstacles.find(candidate =>
            rectanglesOverlap(constrained, candidate) ||
            crossesObstacle(constrained, candidate, previous),
        );
        if (!obstacle)
            break;
        constrained = applyNearestSeparation(constrained, obstacle, previous);
    }
    return constrained;
}

export function constrainRectToConnectedLayout(rect, obstacles, previous = null) {
    const collisionFree = constrainRectToLayout(rect, obstacles, previous);
    const stillOverlaps = obstacles.some(obstacle =>
        rectanglesOverlap(collisionFree, obstacle),
    );
    if (obstacles.length === 0 ||
        (!stillOverlaps && layoutIsConnected([...obstacles, collisionFree])))
        return collisionFree;

    const candidates = obstacles.flatMap(obstacle =>
        attachmentCandidates(collisionFree, obstacle),
    ).filter(candidate => !obstacles.some(obstacle =>
        rectanglesOverlap(candidate, obstacle),
    ) && layoutIsConnected([...obstacles, candidate]));
    candidates.sort((first, second) => {
        const firstDistance = (first.x - collisionFree.x) ** 2 +
            (first.y - collisionFree.y) ** 2;
        const secondDistance = (second.x - collisionFree.x) ** 2 +
            (second.y - collisionFree.y) ** 2;
        return firstDistance - secondDistance;
    });
    if (candidates[0])
        return candidates[0];
    return previous && layoutIsConnected([...obstacles, previous])
        ? {...previous}
        : collisionFree;
}

export function resolveLayoutOverlaps(rects) {
    const resolved = [];
    for (const rect of rects)
        resolved.push(constrainRectToConnectedLayout(rect, resolved));
    return resolved;
}

export function resolveLayoutOverlapsInReferenceOrder(rects, references) {
    if (rects.length !== references.length)
        return resolveLayoutOverlaps(rects);

    const order = rects.map((_rect, index) => index).sort((first, second) =>
        references[first].x - references[second].x ||
        references[first].y - references[second].y ||
        first - second,
    );
    const resolved = resolveLayoutOverlaps(order.map(index => rects[index]));
    const restoredOrder = new Array(rects.length);
    order.forEach((originalIndex, resolvedIndex) => {
        restoredOrder[originalIndex] = resolved[resolvedIndex];
    });
    return restoredOrder;
}

export function resizeRectFromCorner(
    start,
    corner,
    deltaX,
    deltaY,
    minimumWidth,
) {
    return resizeRectFromHandle(
        start,
        corner,
        deltaX,
        deltaY,
        minimumWidth,
    );
}

export function resizeRectFromHandle(
    start,
    handle,
    deltaX,
    deltaY,
    minimumWidth,
) {
    const fromLeft = handle.endsWith('left');
    const fromRight = handle.endsWith('right');
    const fromTop = handle.startsWith('top');
    const fromBottom = handle.startsWith('bottom');
    const aspect = start.width / start.height;
    const widthFromX = start.width + deltaX * (fromLeft ? -1 : 1);
    const heightFromY = start.height + deltaY * (fromTop ? -1 : 1);
    const widthFromY = heightFromY * aspect;
    let requestedWidth;
    if ((fromLeft || fromRight) && (fromTop || fromBottom)) {
        const horizontalChange = Math.abs(widthFromX - start.width);
        const verticalChange = Math.abs(widthFromY - start.width);
        requestedWidth = horizontalChange >= verticalChange
            ? widthFromX
            : widthFromY;
    } else if (fromLeft || fromRight) {
        requestedWidth = widthFromX;
    } else {
        requestedWidth = widthFromY;
    }
    const width = Math.max(minimumWidth, requestedWidth);
    const height = width / aspect;
    const right = start.x + start.width;
    const bottom = start.y + start.height;

    return {
        ...start,
        x: fromLeft
            ? right - width
            : fromRight
                ? start.x
                : start.x + (start.width - width) / 2,
        y: fromTop
            ? bottom - height
            : fromBottom
                ? start.y
                : start.y + (start.height - height) / 2,
        width,
        height,
    };
}
