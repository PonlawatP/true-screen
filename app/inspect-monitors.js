#!/usr/bin/gjs -m

import {getMonitors} from './monitor-service.js';

const monitors = getMonitors().map(monitor => ({
    index: monitor.index,
    connector: monitor.connector,
    displayName: monitor.displayName,
    primary: monitor.primary,
    resolution: monitor.resolution,
    scale: monitor.scale,
    transform: monitor.transform,
    logical: monitor.logical,
    physical: monitor.physical,
    sizeSource: monitor.sizeSource,
}));

print(JSON.stringify(monitors, null, 2));

