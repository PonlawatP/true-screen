const TRANSFORM_NAMES = [
    'Normal',
    '90°',
    '180°',
    '270°',
    'Flipped',
    'Flipped 90°',
    'Flipped 180°',
    'Flipped 270°',
];

export function rotationName(transform) {
    return TRANSFORM_NAMES[transform] ?? `Unknown (${transform})`;
}

export function orientDetectedSize(size, transform) {
    if (transform % 2 !== 1)
        return {...size};
    return {...size, width: size.height, height: size.width};
}

export function alignSizeToLogical(size, logicalWidth, logicalHeight) {
    const logicalPortrait = logicalHeight > logicalWidth;
    const physicalPortrait = size.height > size.width;
    if (logicalPortrait === physicalPortrait)
        return {...size};
    return {...size, width: size.height, height: size.width};
}
