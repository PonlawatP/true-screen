import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const COLORS = [
    [0.25, 0.78, 1.0],
    [1.0, 0.45, 0.72],
    [0.42, 0.92, 0.55],
    [1.0, 0.72, 0.28],
    [0.68, 0.52, 1.0],
    [0.25, 0.9, 0.9],
];
const FADE_DURATION_MS = 180;

const moduleSuffix = import.meta.url.includes('?')
    ? import.meta.url.slice(import.meta.url.indexOf('?'))
    : '';
const {adjacentPhysicalMonitors, mappedPhysicalEdge} =
    await import(`./edge-router.js${moduleSuffix}`);

function format(value) {
    return Math.round(value * 10) / 10;
}

function tickStep(pixelLength, physicalLength) {
    const pixelsPerMm = pixelLength / physicalLength;
    if (pixelsPerMm * 10 >= 10)
        return 10;
    if (pixelsPerMm * 50 >= 10)
        return 50;
    return 100;
}

function drawTicks(context, pixelLength, crossLength, physical, axis, color) {
    const physicalLength = axis === 'x' ? physical.width : physical.height;
    const physicalOrigin = axis === 'x' ? physical.x : physical.y;
    const pixelsPerMm = pixelLength / physicalLength;
    const step = tickStep(pixelLength, physicalLength);
    const majorEvery = step === 10 ? 5 : 2;

    context.setSourceRGBA(...color, 0.95);
    context.setLineWidth(1);
    context.selectFontFace('Sans', 0, 0);
    context.setFontSize(10);
    for (let local = 0; local <= physicalLength + 0.001; local += step) {
        const position = local * pixelsPerMm;
        const major = Math.round(local / step) % majorEvery === 0;
        if (axis === 'x') {
            context.moveTo(position, 0);
            context.lineTo(position, major ? 18 : 11);
            context.stroke();
            context.moveTo(position, crossLength - 1);
            context.lineTo(position, crossLength - (major ? 18 : 11));
            context.stroke();
            if (major) {
                context.moveTo(position + 3, 27);
                context.showText(`${format(physicalOrigin + local)}`);
                context.moveTo(position + 3, crossLength - 20);
                context.showText(`${format(physicalOrigin + local)}`);
            }
        } else {
            context.moveTo(0, position);
            context.lineTo(major ? 18 : 11, position);
            context.stroke();
            context.moveTo(crossLength - 1, position);
            context.lineTo(crossLength - (major ? 18 : 11), position);
            context.stroke();
            if (major && position > 40 && position < pixelLength - 8) {
                context.save();
                context.translate(27, position - 3);
                context.rotate(-Math.PI / 2);
                context.showText(`${format(physicalOrigin + local)}`);
                context.restore();
                context.save();
                context.translate(crossLength - 20, position - 3);
                context.rotate(-Math.PI / 2);
                context.showText(`${format(physicalOrigin + local)}`);
                context.restore();
            }
        }
    }
}

function drawMappedZone(context, width, height, physical, peerPhysical, lane) {
    const mapping = mappedPhysicalEdge(physical, peerPhysical);
    if (!mapping)
        return;

    const thickness = 42;
    let x;
    let y;
    let zoneWidth;
    let zoneHeight;
    if (mapping.axis === 'y') {
        y = (mapping.start - physical.y) / physical.height * height;
        zoneHeight = (mapping.end - mapping.start) / physical.height * height;
        x = mapping.edge === 'right' ? width - thickness : 0;
        zoneWidth = thickness;
    } else {
        x = (mapping.start - physical.x) / physical.width * width;
        zoneWidth = (mapping.end - mapping.start) / physical.width * width;
        y = mapping.edge === 'bottom' ? height - thickness : 0;
        zoneHeight = thickness;
    }

    context.setSourceRGBA(0.25, 1.0, 0.48, 0.32);
    context.rectangle(x, y, zoneWidth, zoneHeight);
    context.fill();
    context.setSourceRGBA(0.35, 1.0, 0.55, 0.98);
    context.setLineWidth(5);
    if (mapping.edge === 'right' || mapping.edge === 'left') {
        const lineX = mapping.edge === 'right' ? width - 4 : 4;
        context.moveTo(lineX, y);
        context.lineTo(lineX, y + zoneHeight);
    } else {
        const lineY = mapping.edge === 'bottom' ? height - 4 : 4;
        context.moveTo(x, lineY);
        context.lineTo(x + zoneWidth, lineY);
    }
    context.stroke();

    const length = format(mapping.end - mapping.start);
    context.setSourceRGBA(0.025, 0.03, 0.045, 0.88);
    const labelY = height - 40 - lane * 32;
    context.rectangle(42, labelY, 250, 28);
    context.fill();
    context.setSourceRGB(0.45, 1.0, 0.62);
    context.selectFontFace('Sans', 0, 1);
    context.setFontSize(12);
    context.moveTo(52, labelY + 19);
    context.showText(`${mapping.edge.toUpperCase()} EDGE  ${length} mm`);
}

function drawLayoutMiniMap(context, width, entries, currentEntry) {
    const physicalRects = entries.map(entry => entry.physical);
    const bounds = {
        x: Math.min(...physicalRects.map(rect => rect.x)),
        y: Math.min(...physicalRects.map(rect => rect.y)),
        right: Math.max(...physicalRects.map(rect => rect.x + rect.width)),
        bottom: Math.max(...physicalRects.map(rect => rect.y + rect.height)),
    };
    const box = {x: Math.max(300, width - 250), y: 42, width: 232, height: 150};
    const scale = Math.min(
        (box.width - 24) / Math.max(1, bounds.right - bounds.x),
        (box.height - 42) / Math.max(1, bounds.bottom - bounds.y),
    );
    const layoutWidth = (bounds.right - bounds.x) * scale;
    const layoutHeight = (bounds.bottom - bounds.y) * scale;
    const offsetX = box.x + (box.width - layoutWidth) / 2;
    const offsetY = box.y + 30 + (box.height - 36 - layoutHeight) / 2;

    context.setSourceRGBA(0.025, 0.03, 0.045, 0.86);
    context.rectangle(box.x, box.y, box.width, box.height);
    context.fill();
    context.setSourceRGB(0.94, 0.96, 1.0);
    context.selectFontFace('Sans', 0, 1);
    context.setFontSize(12);
    context.moveTo(box.x + 10, box.y + 20);
    context.showText(`ALL MONITORS · ${currentEntry.index + 1} IS THIS SCREEN`);

    const ordered = [
        ...entries.filter(entry => entry !== currentEntry),
        currentEntry,
    ];
    ordered.forEach(entry => {
            const rect = entry.physical;
            const entryIndex = entries.indexOf(entry);
            const rectColor = COLORS[entryIndex % COLORS.length];
            const alpha = entry === currentEntry ? 0.62 : 0.18;
            const x = offsetX + (rect.x - bounds.x) * scale;
            const y = offsetY + (rect.y - bounds.y) * scale;
            const rectWidth = rect.width * scale;
            const rectHeight = rect.height * scale;
            context.setSourceRGBA(...rectColor, alpha);
            context.rectangle(x, y, rectWidth, rectHeight);
            context.fillPreserve();
            context.setSourceRGBA(...rectColor, 1.0);
            context.setLineWidth(2);
            context.stroke();
        });
}

function drawMonitorRuler(area, logical, entry, peerEntries, entries, color) {
    const context = area.get_context();
    const [width, height] = area.get_surface_size();
    const physical = entry.physical;

    context.setOperator(Cairo.Operator.CLEAR);
    context.paint();
    context.setOperator(Cairo.Operator.OVER);

    context.setSourceRGBA(0.025, 0.03, 0.045, 0.76);
    context.rectangle(0, 0, width, 34);
    context.fill();
    context.rectangle(0, height - 34, width, 34);
    context.fill();
    context.rectangle(0, 0, 34, height);
    context.fill();
    context.rectangle(width - 34, 0, 34, height);
    context.fill();

    context.setSourceRGBA(...color, 0.96);
    context.setLineWidth(3);
    context.rectangle(1.5, 1.5, width - 3, height - 3);
    context.stroke();
    drawTicks(context, width, height, physical, 'x', color);
    drawTicks(context, height, width, physical, 'y', color);
    peerEntries.forEach((peerEntry, lane) =>
        drawMappedZone(
            context,
            width,
            height,
            physical,
            peerEntry.physical,
            lane,
        ));
    drawLayoutMiniMap(context, width, entries, entry);

    const range = `Monitor ${logical.index + 1}  ·  ` +
        `${peerEntries.length} adjacent  ·  ` +
        `${entry.rotation ?? 'Normal'}  ·  ` +
        `X ${format(physical.x)}–${format(physical.x + physical.width)} mm  ·  ` +
        `Y ${format(physical.y)}–${format(physical.y + physical.height)} mm`;
    context.setSourceRGBA(0.025, 0.03, 0.045, 0.88);
    context.rectangle(36, 38, Math.min(width - 48, 600), 30);
    context.fill();
    context.setSourceRGB(0.96, 0.97, 1.0);
    context.selectFontFace('Sans', 0, 1);
    context.setFontSize(13);
    context.moveTo(45, 58);
    context.showText(range);

    context.$dispose();
}

export class DesktopRulerOverlay {
    constructor() {
        this._actors = [];
        this._retiringActors = new Set();
    }

    get actorCount() {
        return this._actors.length;
    }

    update(logicalMonitors, layout) {
        const settings = layout?.rulerOverlay;
        if (settings?.enabled !== true) {
            this.destroy();
            return;
        }

        // Draft geometry can update on every pointer movement. Carry the
        // current opacity across replacement actors so those updates do not
        // restart the entrance animation or flash at full opacity.
        const initialOpacity = this._currentOpacity();
        this._destroyImmediately([
            ...this._actors,
            ...this._retiringActors,
        ]);
        this._actors = [];
        this._retiringActors.clear();

        const entries = layout.monitors.filter(entry => entry?.physical);
        logicalMonitors.forEach((logical, position) => {
            const entry = entries.find(candidate => candidate.index === logical.index);
            if (!entry)
                return;
            const peerEntries = adjacentPhysicalMonitors(entry, entries);
            if (peerEntries.length === 0)
                return;

            const actor = new St.DrawingArea({
                x: logical.x,
                y: logical.y,
                width: logical.width,
                height: logical.height,
                reactive: false,
                can_focus: false,
                track_hover: false,
                opacity: initialOpacity,
            });
            actor.connect('repaint', area => drawMonitorRuler(
                area,
                logical,
                entry,
                peerEntries,
                entries,
                COLORS[position % COLORS.length],
            ));
            Main.uiGroup.add_child(actor);
            actor.queue_repaint();
            this._actors.push(actor);
            if (initialOpacity < 255) {
                actor.ease({
                    opacity: 255,
                    duration: FADE_DURATION_MS,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            }
        });
    }

    destroy({animate = true} = {}) {
        const actors = this._actors;
        this._actors = [];

        if (!animate) {
            this._destroyImmediately([
                ...actors,
                ...this._retiringActors,
            ]);
            this._retiringActors.clear();
            return;
        }

        for (const actor of actors) {
            actor.remove_all_transitions();
            this._retiringActors.add(actor);
            actor.ease({
                opacity: 0,
                duration: FADE_DURATION_MS,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    this._retiringActors.delete(actor);
                    actor.destroy();
                },
            });
        }
    }

    dispose() {
        this.destroy({animate: false});
    }

    _currentOpacity() {
        const actors = this._actors.length > 0
            ? this._actors
            : [...this._retiringActors];
        return actors.length > 0
            ? Math.max(...actors.map(actor => actor.opacity))
            : 0;
    }

    _destroyImmediately(actors) {
        for (const actor of actors) {
            actor.remove_all_transitions();
            actor.destroy();
        }
    }
}
