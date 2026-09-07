#!/usr/bin/gjs -m

import Cairo from 'cairo';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

import {MonitorCanvas} from '../../app/monitor-canvas.js';

Gtk.init();

const outputPath = GLib.getenv('TRUE_SCREEN_RULER_RENDER');
if (!outputPath)
    throw new Error('TRUE_SCREEN_RULER_RENDER is required');

const canvas = new MonitorCanvas();
canvas.monitors = [
    {
        index: 0,
        displayName: '24-inch display',
        physical: {x: 0, y: 40, width: 530, height: 300},
    },
    {
        index: 1,
        displayName: '27-inch display',
        physical: {x: 530, y: 0, width: 600, height: 340},
    },
];
canvas.selectedIndex = 0;
canvas.setRulerOverlay(true, 1);

const width = 1000;
const height = 620;
const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, width, height);
const context = new Cairo.Context(surface);
canvas._draw(canvas, context, width, height);
surface.writeToPNG(outputPath);

const firstRect = canvas._canvasRect(canvas.monitors[0]);
const expectedCursors = [
    [firstRect.x + firstRect.width / 2, firstRect.y + firstRect.height / 2, 'grab'],
    [firstRect.x + 2, firstRect.y + 2, 'nwse-resize'],
    [firstRect.x + firstRect.width - 2, firstRect.y + 2, 'nesw-resize'],
    [firstRect.x + 2, firstRect.y + firstRect.height / 2, 'ew-resize'],
    [firstRect.x + firstRect.width / 2, firstRect.y + 2, 'ns-resize'],
    [0, height - 1, 'default'],
];
for (const [x, y, expected] of expectedCursors) {
    const actual = canvas._cursorNameAt(x, y);
    if (actual !== expected)
        throw new Error(`Expected ${expected} cursor, got ${actual}`);
}
canvas._dragState = {mode: 'move'};
if (canvas._cursorNameAt(firstRect.x, firstRect.y) !== 'grabbing')
    throw new Error('Expected grabbing cursor while moving a monitor');
canvas._dragState = {mode: 'resize', handle: 'bottom-right'};
if (canvas._cursorNameAt(firstRect.x, firstRect.y) !== 'nwse-resize')
    throw new Error('Expected resize cursor to remain stable during a resize');
canvas._dragState = null;

print(JSON.stringify({passed: true, outputPath}));
