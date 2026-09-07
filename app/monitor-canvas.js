import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';

import {
    constrainRectToConnectedLayout,
    resizeRectFromHandle,
} from './monitor-layout-geometry.js';
import {rulerMetrics} from './ruler-geometry.js';

const PADDING = 36;
const HANDLE_SIZE = 14;
const MIN_MONITOR_MM = 60;
const SNAP_MM = 5;

export const MonitorCanvas = GObject.registerClass(
class MonitorCanvas extends Gtk.DrawingArea {
    _init() {
        super._init({
            hexpand: true,
            vexpand: true,
            content_width: 720,
            content_height: 500,
        });

        this.monitors = [];
        this.selectedIndex = null;
        this.onSelectionChanged = null;
        this.onLayoutChanged = null;
        this.rulerEnabled = false;
        this.rulerReferenceIndex = null;
        this._viewport = {scale: 1, offsetX: PADDING, offsetY: PADDING};
        this._dragState = null;
        this._pointerPosition = null;

        this.set_draw_func(this._draw.bind(this));

        const drag = Gtk.GestureDrag.new();
        drag.set_button(1);
        drag.connect('drag-begin', this._onDragBegin.bind(this));
        drag.connect('drag-update', this._onDragUpdate.bind(this));
        drag.connect('drag-end', this._onDragEnd.bind(this));
        this.add_controller(drag);

        const motion = Gtk.EventControllerMotion.new();
        motion.connect('enter', (_controller, x, y) => this._onPointerMotion(x, y));
        motion.connect('motion', (_controller, x, y) => this._onPointerMotion(x, y));
        motion.connect('leave', () => {
            this._pointerPosition = null;
            if (!this._dragState)
                this.set_cursor_from_name('default');
        });
        this.add_controller(motion);
    }

    setMonitors(monitors) {
        this.monitors = monitors;
        this.selectedIndex = monitors[0]?.index ?? null;
        this.queue_draw();
        this.onSelectionChanged?.(this.selectedMonitor());
    }

    selectedMonitor() {
        return this.monitors.find(monitor => monitor.index === this.selectedIndex) ?? null;
    }

    selectMonitor(index) {
        if (!this.monitors.some(monitor => monitor.index === index))
            return false;
        this.selectedIndex = index;
        this.queue_draw();
        this.onSelectionChanged?.(this.selectedMonitor());
        return true;
    }

    setRulerOverlay(enabled, referenceIndex = null) {
        this.rulerEnabled = enabled;
        this.rulerReferenceIndex = referenceIndex;
        this.queue_draw();
    }

    constrainMonitor(monitor) {
        const obstacles = this.monitors
            .filter(other => other !== monitor)
            .map(other => other.physical);
        const constrained = constrainRectToConnectedLayout(
            monitor.physical,
            obstacles,
            monitor.physical,
        );
        Object.assign(monitor.physical, constrained);
    }

    _calculateViewport(width, height) {
        if (this.monitors.length === 0)
            return {scale: 1, offsetX: PADDING, offsetY: PADDING};

        const minX = Math.min(...this.monitors.map(m => m.physical.x));
        const minY = Math.min(...this.monitors.map(m => m.physical.y));
        const maxX = Math.max(...this.monitors.map(m => m.physical.x + m.physical.width));
        const maxY = Math.max(...this.monitors.map(m => m.physical.y + m.physical.height));
        const layoutWidth = Math.max(1, maxX - minX);
        const layoutHeight = Math.max(1, maxY - minY);
        const scale = Math.max(0.05, Math.min(
            (width - PADDING * 2) / layoutWidth,
            (height - PADDING * 2) / layoutHeight,
        ));

        return {
            scale,
            offsetX: (width - layoutWidth * scale) / 2 - minX * scale,
            offsetY: (height - layoutHeight * scale) / 2 - minY * scale,
        };
    }

    _canvasRect(monitor) {
        const {scale, offsetX, offsetY} = this._viewport;
        return {
            x: offsetX + monitor.physical.x * scale,
            y: offsetY + monitor.physical.y * scale,
            width: monitor.physical.width * scale,
            height: monitor.physical.height * scale,
        };
    }

    _draw(_area, context, width, height) {
        context.setSourceRGB(0.075, 0.085, 0.105);
        context.paint();
        this._viewport = this._calculateViewport(width, height);

        for (const monitor of this.monitors) {
            const rect = this._canvasRect(monitor);
            const selected = monitor.index === this.selectedIndex;

            context.setSourceRGB(
                selected ? 0.18 : 0.13,
                selected ? 0.43 : 0.20,
                selected ? 0.68 : 0.28,
            );
            context.rectangle(rect.x, rect.y, rect.width, rect.height);
            context.fillPreserve();
            context.setLineWidth(selected ? 3 : 1.5);
            context.setSourceRGB(selected ? 0.42 : 0.28, selected ? 0.72 : 0.34, 0.95);
            context.stroke();

            context.setSourceRGB(0.96, 0.97, 1.0);
            context.selectFontFace('Sans', 0, 1);
            context.setFontSize(Math.max(13, Math.min(22, rect.height / 7)));
            context.moveTo(rect.x + 12, rect.y + 28);
            context.showText(`${monitor.index + 1}  ${monitor.displayName}`);

            context.selectFontFace('Sans', 0, 0);
            context.setFontSize(12);
            context.moveTo(rect.x + 12, rect.y + 48);
            context.showText(
                `${Math.round(monitor.physical.width)} × ` +
                `${Math.round(monitor.physical.height)} mm`,
            );
            context.moveTo(rect.x + 12, rect.y + 65);
            context.showText(monitor.rotation ?? 'Normal');

            if (selected) {
                context.setSourceRGB(0.95, 0.78, 0.25);
                for (const handleX of [rect.x, rect.x + rect.width - HANDLE_SIZE]) {
                    for (const handleY of [rect.y, rect.y + rect.height - HANDLE_SIZE])
                        context.rectangle(handleX, handleY, HANDLE_SIZE, HANDLE_SIZE);
                }
                const edgeLength = HANDLE_SIZE * 2;
                const edgeThickness = HANDLE_SIZE / 2;
                context.rectangle(
                    rect.x + (rect.width - edgeLength) / 2,
                    rect.y,
                    edgeLength,
                    edgeThickness,
                );
                context.rectangle(
                    rect.x + (rect.width - edgeLength) / 2,
                    rect.y + rect.height - edgeThickness,
                    edgeLength,
                    edgeThickness,
                );
                context.rectangle(
                    rect.x,
                    rect.y + (rect.height - edgeLength) / 2,
                    edgeThickness,
                    edgeLength,
                );
                context.rectangle(
                    rect.x + rect.width - edgeThickness,
                    rect.y + (rect.height - edgeLength) / 2,
                    edgeThickness,
                    edgeLength,
                );
                context.fill();
            }
        }


        this._drawRulerOverlay(context, width, height);
    }

    _rulerPair() {
        if (!this.rulerEnabled)
            return null;
        const first = this.selectedMonitor();
        const second = this.monitors.find(
            monitor => monitor.index === this.rulerReferenceIndex,
        );
        return first && second && first !== second ? {first, second} : null;
    }

    _rulerStep() {
        if (this._viewport.scale * 10 >= 9)
            return 10;
        if (this._viewport.scale * 50 >= 9)
            return 50;
        return 100;
    }

    _drawAxisTicks(context, start, end, axis, width, height) {
        const {scale, offsetX, offsetY} = this._viewport;
        const step = this._rulerStep();
        const firstTick = Math.ceil(start / step) * step;
        const majorEvery = step === 10 ? 5 : 2;

        context.setSourceRGBA(0.83, 0.87, 0.94, 0.82);
        context.setLineWidth(1);
        context.selectFontFace('Sans', 0, 0);
        context.setFontSize(9);

        for (let value = firstTick; value <= end + 0.001; value += step) {
            const ordinal = Math.round(value / step);
            const major = ordinal % majorEvery === 0;
            if (axis === 'x') {
                const position = offsetX + value * scale;
                context.moveTo(position, 4);
                context.lineTo(position, major ? 16 : 11);
                context.stroke();
                context.moveTo(position, height - 4);
                context.lineTo(position, height - (major ? 16 : 11));
                context.stroke();
                if (major && position >= 2 && position <= width - 28) {
                    context.moveTo(position + 2, 13);
                    context.showText(`${Math.round(value)}`);
                    context.moveTo(position + 2, height - 19);
                    context.showText(`${Math.round(value)}`);
                }
            } else {
                const position = offsetY + value * scale;
                context.moveTo(4, position);
                context.lineTo(major ? 16 : 11, position);
                context.stroke();
                context.moveTo(width - 4, position);
                context.lineTo(width - (major ? 16 : 11), position);
                context.stroke();
                if (major && position >= 12 && position <= height - 2) {
                    context.save();
                    context.translate(13, position - 2);
                    context.rotate(-Math.PI / 2);
                    context.showText(`${Math.round(value)}`);
                    context.restore();
                    context.save();
                    context.translate(width - 13, position - 2);
                    context.rotate(-Math.PI / 2);
                    context.showText(`${Math.round(value)}`);
                    context.restore();
                }
            }
        }
    }

    _drawRange(context, monitor, axis, lane, color) {
        const rect = monitor.physical;
        const {scale, offsetX, offsetY} = this._viewport;
        context.setSourceRGBA(...color, 0.95);
        context.setLineWidth(4);
        if (axis === 'x') {
            context.moveTo(offsetX + rect.x * scale, lane);
            context.lineTo(offsetX + (rect.x + rect.width) * scale, lane);
        } else {
            context.moveTo(lane, offsetY + rect.y * scale);
            context.lineTo(lane, offsetY + (rect.y + rect.height) * scale);
        }
        context.stroke();
    }

    _drawRulerOverlay(context, width, height) {
        const pair = this._rulerPair();
        if (!pair)
            return;

        const metrics = rulerMetrics(pair.first.physical, pair.second.physical);
        const bounds = metrics.bounds;
        this._drawAxisTicks(context, bounds.x, bounds.x + bounds.width, 'x', width, height);
        this._drawAxisTicks(context, bounds.y, bounds.y + bounds.height, 'y', width, height);
        this._drawRange(context, pair.first, 'x', 21, [0.25, 0.78, 1.0]);
        this._drawRange(context, pair.second, 'x', 27, [1.0, 0.45, 0.72]);
        this._drawRange(context, pair.first, 'x', height - 21, [0.25, 0.78, 1.0]);
        this._drawRange(context, pair.second, 'x', height - 27, [1.0, 0.45, 0.72]);
        this._drawRange(context, pair.first, 'y', 21, [0.25, 0.78, 1.0]);
        this._drawRange(context, pair.second, 'y', 27, [1.0, 0.45, 0.72]);
        this._drawRange(context, pair.first, 'y', width - 21, [0.25, 0.78, 1.0]);
        this._drawRange(context, pair.second, 'y', width - 27, [1.0, 0.45, 0.72]);

        const firstRect = this._canvasRect(pair.first);
        const secondRect = this._canvasRect(pair.second);
        context.setLineWidth(1);
        context.setDash([5, 5], 0);
        context.setSourceRGBA(0.25, 0.78, 1.0, 0.55);
        context.rectangle(firstRect.x, firstRect.y, firstRect.width, firstRect.height);
        context.stroke();
        context.setSourceRGBA(1.0, 0.45, 0.72, 0.55);
        context.rectangle(secondRect.x, secondRect.y, secondRect.width, secondRect.height);
        context.stroke();
        context.setDash([], 0);

        const format = value => Math.round(value * 10) / 10;
        const text =
            `${pair.first.index + 1} vs ${pair.second.index + 1} origin Δ ` +
            `${format(metrics.delta.x)}, ${format(metrics.delta.y)} mm  ·  ` +
            `X gap ${format(metrics.horizontal.gap)} / overlap ` +
            `${format(metrics.horizontal.overlap)} mm  ·  ` +
            `Y gap ${format(metrics.vertical.gap)} / overlap ` +
            `${format(metrics.vertical.overlap)} mm`;

        context.setSourceRGBA(0.025, 0.03, 0.045, 0.88);
        context.rectangle(0, height - 64, width, 32);
        context.fill();
        context.setSourceRGB(0.94, 0.96, 1.0);
        context.selectFontFace('Sans', 0, 0);
        context.setFontSize(11);
        context.moveTo(12, height - 43);
        context.showText(text);
    }

    _hitTest(x, y) {
        for (const monitor of [...this.monitors].reverse()) {
            const rect = this._canvasRect(monitor);
            if (x >= rect.x && x <= rect.x + rect.width &&
                y >= rect.y && y <= rect.y + rect.height)
                return {monitor, rect};
        }
        return null;
    }

    _onDragBegin(_gesture, x, y) {
        const hit = this._hitTest(x, y);
        if (!hit) {
            this.selectedIndex = null;
            this.queue_draw();
            this.onSelectionChanged?.(null);
            return;
        }

        this.selectedIndex = hit.monitor.index;
        const handle = this._resizeHandleAt(hit.rect, x, y);
        this._dragState = {
            monitor: hit.monitor,
            mode: handle ? 'resize' : 'move',
            handle,
            start: {...hit.monitor.physical},
        };
        this.set_cursor_from_name(this._cursorNameAt(x, y));
        this.queue_draw();
        this.onSelectionChanged?.(hit.monitor);
    }

    _resizeHandleAt(rect, x, y) {
        const tolerance = HANDLE_SIZE * 1.5;
        const horizontal = x <= rect.x + tolerance
            ? 'left'
            : x >= rect.x + rect.width - tolerance ? 'right' : null;
        const vertical = y <= rect.y + tolerance
            ? 'top'
            : y >= rect.y + rect.height - tolerance ? 'bottom' : null;
        if (horizontal && vertical)
            return `${vertical}-${horizontal}`;
        return horizontal ?? vertical;
    }

    _cursorNameAt(x, y) {
        if (this._dragState) {
            if (this._dragState.mode === 'move')
                return 'grabbing';
            return this._resizeCursorName(this._dragState.handle);
        }

        const hit = this._hitTest(x, y);
        if (!hit)
            return 'default';
        const handle = this._resizeHandleAt(hit.rect, x, y);
        return handle ? this._resizeCursorName(handle) : 'grab';
    }

    _resizeCursorName(handle) {
        if (handle === 'left' || handle === 'right')
            return 'ew-resize';
        if (handle === 'top' || handle === 'bottom')
            return 'ns-resize';
        return handle === 'top-left' || handle === 'bottom-right'
            ? 'nwse-resize'
            : 'nesw-resize';
    }

    _onPointerMotion(x, y) {
        this._pointerPosition = {x, y};
        this.set_cursor_from_name(this._cursorNameAt(x, y));
    }

    _onDragUpdate(_gesture, offsetX, offsetY) {
        if (!this._dragState)
            return;

        const deltaX = offsetX / this._viewport.scale;
        const deltaY = offsetY / this._viewport.scale;
        const {monitor, mode, start, handle} = this._dragState;
        const obstacles = this.monitors
            .filter(other => other !== monitor)
            .map(other => other.physical);
        if (mode === 'move') {
            const previous = {...monitor.physical};
            const proposed = {
                ...monitor.physical,
                x: start.x + deltaX,
                y: start.y + deltaY,
            };
            const constrained = constrainRectToConnectedLayout(
                proposed,
                obstacles,
                previous,
            );
            monitor.physical.x = constrained.x;
            monitor.physical.y = constrained.y;
        } else {
            const previous = {...monitor.physical};
            const proposed = resizeRectFromHandle(
                start,
                handle,
                deltaX,
                deltaY,
                MIN_MONITOR_MM,
            );
            const constrained = constrainRectToConnectedLayout(
                proposed,
                obstacles,
                previous,
            );
            Object.assign(monitor.physical, constrained);
            monitor.sizeSource = 'manual';
        }

        this.queue_draw();
        this.onLayoutChanged?.(monitor);
    }

    _snapMonitor(monitor) {
        const previous = {...monitor.physical};
        let bestX = monitor.physical.x;
        let bestY = monitor.physical.y;
        let distanceX = SNAP_MM + 1;
        let distanceY = SNAP_MM + 1;

        for (const other of this.monitors) {
            if (other === monitor)
                continue;

            const xCandidates = [
                other.physical.x,
                other.physical.x + other.physical.width,
                other.physical.x - monitor.physical.width,
                other.physical.x + other.physical.width - monitor.physical.width,
            ];
            for (const candidate of xCandidates) {
                const distance = Math.abs(monitor.physical.x - candidate);
                if (distance < distanceX && distance <= SNAP_MM) {
                    bestX = candidate;
                    distanceX = distance;
                }
            }

            const yCandidates = [
                other.physical.y,
                other.physical.y + other.physical.height,
                other.physical.y - monitor.physical.height,
                other.physical.y + other.physical.height - monitor.physical.height,
            ];
            for (const candidate of yCandidates) {
                const distance = Math.abs(monitor.physical.y - candidate);
                if (distance < distanceY && distance <= SNAP_MM) {
                    bestY = candidate;
                    distanceY = distance;
                }
            }
        }

        const obstacles = this.monitors
            .filter(other => other !== monitor)
            .map(other => other.physical);
        const constrained = constrainRectToConnectedLayout({
            ...monitor.physical,
            x: bestX,
            y: bestY,
        }, obstacles, previous);
        monitor.physical.x = constrained.x;
        monitor.physical.y = constrained.y;
    }

    _onDragEnd() {
        if (this._dragState?.mode === 'move')
            this._snapMonitor(this._dragState.monitor);
        const monitor = this._dragState?.monitor ?? null;
        this._dragState = null;
        if (this._pointerPosition)
            this.set_cursor_from_name(this._cursorNameAt(
                this._pointerPosition.x,
                this._pointerPosition.y,
            ));
        else
            this.set_cursor_from_name('default');
        this.queue_draw();
        if (monitor)
            this.onLayoutChanged?.(monitor);
    }
});
