#!/usr/bin/gjs -m

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';

import {configPath, loadLayout, saveLayout} from './config-store.js';
import {
    countAdjustedMonitorPositions,
    selectLayout,
    withRulerOverlay,
} from './layout-profiles.js';
import {MonitorCanvas} from './monitor-canvas.js';
import {getMonitors, serializeLayout} from './monitor-service.js';

const APP_ID = 'io.plutostudio.TrueScreen';
const EXTENSION_DBUS_NAME = 'io.plutostudio.TrueScreen.Spike';
const EXTENSION_DBUS_PATH = '/io/plutostudio/TrueScreen/Spike';
const EXTENSION_DBUS_INTERFACE = 'io.plutostudio.TrueScreen.Spike';

const TrueScreenWindow = GObject.registerClass(class TrueScreenWindow extends Adw.ApplicationWindow {
    constructor(application) {
        super({
            application,
            title: 'True Screen',
            default_width: 1120,
            default_height: 700,
        });

        this._monitors = [];
        this._updatingInspector = false;
        this._updatingRulerControls = false;
        this._loadingLayout = false;
        this._draftDirty = false;
        this._comparisonIndex = null;
        this._rulerPreviewSourceId = 0;
        this._closing = false;
        this._closeDialog = null;
        this._buildUi();
        this._refresh();
        this.connect('close-request', () => this._onCloseRequest());
    }

    _buildUi() {
        const toolbar = new Adw.ToolbarView();
        const header = new Adw.HeaderBar();
        toolbar.add_top_bar(header);

        this._refreshButton = new Gtk.Button({
            icon_name: 'view-refresh-symbolic',
            tooltip_text: 'Refresh monitors from Mutter',
        });
        this._refreshButton.connect('clicked', () => this._refresh());
        header.pack_start(this._refreshButton);

        const rulerControl = new Gtk.Box({
            spacing: 6,
            valign: Gtk.Align.CENTER,
            tooltip_text: 'Show or hide the ruler immediately on every connected desktop',
        });
        rulerControl.append(new Gtk.Label({label: 'Ruler overlay'}));
        this._rulerSwitch = new Gtk.Switch({valign: Gtk.Align.CENTER});
        this._rulerSwitch.connect('notify::active', () => {
            this._syncRulerOverlay();
            if (!this._loadingLayout) {
                this._scheduleRulerPreview();
                this._saveRulerOverlay();
            }
        });
        rulerControl.append(this._rulerSwitch);
        header.pack_start(rulerControl);

        const remapControl = new Gtk.Box({
            spacing: 6,
            valign: Gtk.Align.CENTER,
            tooltip_text: 'Enable cursor correction after Apply to desktop',
        });
        remapControl.append(new Gtk.Label({label: 'Remap cursor'}));
        this._remapSwitch = new Gtk.Switch({valign: Gtk.Align.CENTER});
        this._remapSwitch.connect('notify::active', () => {
            this._skipGapsSwitch?.set_sensitive(this._remapSwitch.get_active());
            this._markDirty();
        });
        remapControl.append(this._remapSwitch);
        header.pack_end(remapControl);

        const applyButton = new Gtk.Button({
            label: 'Apply to desktop',
            css_classes: ['suggested-action'],
        });
        applyButton.connect('clicked', () => this._apply());
        header.pack_end(applyButton);

        const paned = new Gtk.Paned({orientation: Gtk.Orientation.HORIZONTAL});
        this._canvas = new MonitorCanvas();
        this._canvas.onSelectionChanged = monitor => {
            this._showMonitor(monitor);
            if (this._rulerSwitch.get_active() && !this._loadingLayout) {
                this._scheduleRulerPreview();
                this._saveRulerOverlay();
            }
        };
        this._canvas.onLayoutChanged = monitor => {
            this._showMonitor(monitor);
            this._markDirty();
            this._scheduleRulerPreview();
        };
        paned.set_start_child(this._canvas);
        paned.set_resize_start_child(true);
        paned.set_shrink_start_child(false);

        const inspector = this._buildInspector();
        paned.set_end_child(inspector);
        paned.set_resize_end_child(false);
        paned.set_shrink_end_child(false);
        paned.set_position(810);
        toolbar.set_content(paned);

        this._status = new Gtk.Label({
            label: `Config: ${configPath()}`,
            xalign: 0,
            margin_start: 12,
            margin_end: 12,
            margin_top: 7,
            margin_bottom: 7,
            css_classes: ['dim-label'],
        });
        toolbar.add_bottom_bar(this._status);
        this.set_content(toolbar);
    }

    _buildInspector() {
        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            width_request: 300,
            margin_start: 18,
            margin_end: 18,
            margin_top: 18,
            margin_bottom: 18,
        });

        const gapControl = new Gtk.Box({spacing: 12});
        gapControl.append(new Gtk.Label({
            label: 'Skip screen gaps', xalign: 0, hexpand: true,
        }));
        this._skipGapsSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
            sensitive: false,
            tooltip_text: 'Jump across empty space to the nearest screen in the direction of movement. Requires Remap cursor and Apply to desktop.',
        });
        this._skipGapsSwitch.connect('notify::active', () => this._markDirty());
        gapControl.append(this._skipGapsSwitch);
        box.append(gapControl);
        box.append(new Gtk.Separator({orientation: Gtk.Orientation.HORIZONTAL}));

        const title = new Gtk.Label({
            label: 'Monitor',
            xalign: 0,
            css_classes: ['title-2'],
        });
        box.append(title);

        this._nameLabel = new Gtk.Label({xalign: 0, wrap: true});
        this._detailsLabel = new Gtk.Label({xalign: 0, wrap: true, css_classes: ['dim-label']});
        box.append(this._nameLabel);
        box.append(this._detailsLabel);

        const grid = new Gtk.Grid({column_spacing: 10, row_spacing: 10});
        this._spins = {};
        const fields = [
            ['x', 'X position (mm)', -10000, 10000],
            ['y', 'Y position (mm)', -10000, 10000],
            ['width', 'Width (mm)', 60, 5000],
            ['height', 'Height (mm)', 40, 5000],
        ];
        fields.forEach(([key, label, min, max], row) => {
            grid.attach(new Gtk.Label({label, xalign: 0}), 0, row, 1, 1);
            const spin = Gtk.SpinButton.new_with_range(min, max, 1);
            spin.set_digits(1);
            spin.set_hexpand(true);
            spin.connect('value-changed', () => this._onNumericChanged(key, spin.get_value()));
            grid.attach(spin, 1, row, 1, 1);
            this._spins[key] = spin;
        });
        box.append(grid);

        const rulerTitle = new Gtk.Label({
            label: 'Measure selected monitor against',
            xalign: 0,
            margin_top: 8,
        });
        box.append(rulerTitle);
        this._comparisonCombo = new Gtk.ComboBoxText();
        this._comparisonCombo.connect('changed', () => {
            if (this._updatingRulerControls)
                return;
            const id = this._comparisonCombo.get_active_id();
            this._comparisonIndex = id === null ? null : Number.parseInt(id, 10);
            this._syncRulerOverlay();
            if (this._rulerSwitch.get_active()) {
                this._scheduleRulerPreview();
                this._saveRulerOverlay();
            }
        });
        box.append(this._comparisonCombo);

        const help = new Gtk.Label({
            label: 'Drag inside a monitor overlay to move it. Drag any yellow edge or corner handle to resize while preserving its aspect ratio.',
            wrap: true,
            xalign: 0,
            css_classes: ['dim-label'],
        });
        box.append(help);
        return box;
    }

    _refresh() {
        this._loadingLayout = true;
        try {
            const document = loadLayout();
            this._monitors = getMonitors(document);
            const layout = selectLayout(document, this._monitors);
            const savedMonitors = layout?.monitors ?? [];
            const adjustedPositions = countAdjustedMonitorPositions(
                savedMonitors,
                this._monitors,
            );
            this._remapSwitch.set_active(layout?.enabled ?? false);
            this._skipGapsSwitch.set_active(layout?.skipScreenGaps === true);
            this._skipGapsSwitch.set_sensitive(this._remapSwitch.get_active());
            this._canvas.setMonitors(this._monitors);
            const ruler = layout?.rulerOverlay;
            if (Number.isInteger(ruler?.firstIndex))
                this._canvas.selectMonitor(ruler.firstIndex);
            this._comparisonIndex = Number.isInteger(ruler?.secondIndex)
                ? ruler.secondIndex
                : null;
            this._rulerSwitch.set_active(ruler?.enabled === true);
            this._updateRulerControls(this._canvas.selectedMonitor());
            this._draftDirty = false;
            if (adjustedPositions > 0) {
                const correctedLayout = serializeLayout(
                    this._monitors,
                    layout?.enabled === true,
                    this._rulerOverlay(ruler?.enabled === true),
                    layout?.skipScreenGaps === true,
                );
                const path = saveLayout(correctedLayout);
                this._status.set_label(
                    `Auto-aligned ${adjustedPositions} monitor ` +
                    `position${adjustedPositions === 1 ? '' : 's'} · ${path}`,
                );
            } else {
                this._status.set_label(
                    `Loaded ${this._monitors.length} monitors · cursor remapping ` +
                    `${layout?.enabled === true ? 'ON' : 'OFF'} · desktop ruler ` +
                    `${ruler?.enabled === true ? 'ON' : 'OFF'}`,
                );
            }
        } catch (error) {
            this._status.set_label(`Monitor discovery failed: ${error.message}`);
            console.error(error);
        } finally {
            this._loadingLayout = false;
            this._scheduleRulerPreview();
        }
    }

    _showMonitor(monitor) {
        this._updatingInspector = true;
        const sensitive = monitor !== null;
        Object.values(this._spins).forEach(spin => spin.set_sensitive(sensitive));
        if (!monitor) {
            this._nameLabel.set_label('No monitor selected');
            this._detailsLabel.set_label('');
            this._updatingInspector = false;
            this._updateRulerControls(null);
            return;
        }

        this._nameLabel.set_label(`${monitor.index + 1}. ${monitor.displayName}`);
        this._detailsLabel.set_label(
            `${monitor.connector} · ${monitor.resolution} · ` +
            `${monitor.scale}× scale · ${monitor.rotation} · ${monitor.sizeSource}`,
        );
        for (const key of ['x', 'y', 'width', 'height'])
            this._spins[key].set_value(monitor.physical[key]);
        this._updatingInspector = false;
        this._updateRulerControls(monitor);
    }

    _updateRulerControls(selected) {
        this._updatingRulerControls = true;
        this._comparisonCombo.remove_all();
        const candidates = this._monitors.filter(monitor => monitor !== selected);
        for (const monitor of candidates) {
            this._comparisonCombo.append(
                `${monitor.index}`,
                `${monitor.index + 1}. ${monitor.displayName}`,
            );
        }

        if (!candidates.some(monitor => monitor.index === this._comparisonIndex))
            this._comparisonIndex = candidates[0]?.index ?? null;
        if (this._comparisonIndex !== null)
            this._comparisonCombo.set_active_id(`${this._comparisonIndex}`);

        this._comparisonCombo.set_sensitive(selected !== null && candidates.length > 0);
        this._rulerSwitch.set_sensitive(this._monitors.length > 0);
        this._updatingRulerControls = false;
        this._syncRulerOverlay();
    }

    _syncRulerOverlay() {
        this._canvas.setRulerOverlay(
            this._rulerSwitch.get_active() && this._rulerSwitch.get_sensitive(),
            this._comparisonIndex,
        );
    }

    _onNumericChanged(key, value) {
        if (this._updatingInspector)
            return;
        const monitor = this._canvas.selectedMonitor();
        if (!monitor)
            return;
        monitor.physical[key] = value;
        if (key === 'width' || key === 'height')
            monitor.sizeSource = 'manual';
        this._canvas.constrainMonitor(monitor);
        this._canvas.queue_draw();
        this._markDirty();
        this._scheduleRulerPreview();
    }

    _markDirty() {
        this._draftDirty = true;
        this._status.set_label('Draft changed — press Apply to desktop');
    }

    _rulerOverlay(enabled = this._rulerSwitch.get_active()) {
        return {
            enabled,
            firstIndex: this._canvas.selectedMonitor()?.index ?? null,
            secondIndex: this._comparisonIndex,
        };
    }

    _scheduleRulerPreview() {
        if (this._loadingLayout || this._closing || this._rulerPreviewSourceId)
            return;
        this._rulerPreviewSourceId = GLib.idle_add(
            GLib.PRIORITY_DEFAULT_IDLE,
            () => {
                this._rulerPreviewSourceId = 0;
                if (this._rulerSwitch.get_active() && this._monitors.length > 0) {
                    this._callRulerPreview(
                        'PreviewRuler',
                        serializeLayout(
                            this._monitors,
                            false,
                            this._rulerOverlay(true),
                        ),
                    );
                } else {
                    this._callRulerPreview('ClearRulerPreview');
                }
                return GLib.SOURCE_REMOVE;
            },
        );
    }

    _callRulerPreview(method, layout = null, synchronous = false) {
        const parameters = layout
            ? new GLib.Variant('(s)', [JSON.stringify(layout)])
            : null;
        if (synchronous) {
            try {
                Gio.DBus.session.call_sync(
                    EXTENSION_DBUS_NAME,
                    EXTENSION_DBUS_PATH,
                    EXTENSION_DBUS_INTERFACE,
                    method,
                    parameters,
                    null,
                    Gio.DBusCallFlags.NONE,
                    1000,
                    null,
                );
            } catch (error) {
                console.debug(
                    `[True Screen] Desktop ruler teardown unavailable: ${error.message}`,
                );
            }
            return;
        }
        Gio.DBus.session.call(
            EXTENSION_DBUS_NAME,
            EXTENSION_DBUS_PATH,
            EXTENSION_DBUS_INTERFACE,
            method,
            parameters,
            null,
            Gio.DBusCallFlags.NONE,
            1000,
            null,
            (connection, result) => {
                try {
                    connection.call_finish(result);
                } catch (error) {
                    console.debug(
                        `[True Screen] Desktop ruler preview unavailable: ${error.message}`,
                    );
                }
            },
        );
    }

    _saveRulerOverlay(enabled = this._rulerSwitch.get_active()) {
        try {
            const document = loadLayout();
            const appliedLayout = selectLayout(document, this._monitors);
            const rulerOverlay = this._rulerOverlay(enabled);
            const layout = withRulerOverlay(appliedLayout, rulerOverlay);
            if (!layout)
                return null;
            const path = saveLayout(layout);
            const pending = this._draftDirty
                ? ' · other draft changes still need Apply'
                : '';
            this._status.set_label(
                `Desktop ruler ${rulerOverlay.enabled ? 'shown' : 'hidden'} immediately` +
                `${pending} · ${path}`,
            );
        } catch (error) {
            this._status.set_label(`Ruler update failed: ${error.message}`);
            console.error(error);
            return null;
        }
    }

    _onCloseRequest() {
        if (this._closing)
            return false;
        if (!this._draftDirty) {
            this._teardownRuler();
            return false;
        }
        if (this._closeDialog)
            return true;

        const dialog = new Adw.AlertDialog({
            heading: 'Apply layout changes before closing?',
            body: 'The ruler is showing an unapplied draft. Choose whether to apply it, discard it, or keep editing.',
            close_response: 'cancel',
            default_response: 'apply',
        });
        dialog.add_response('discard', 'Exit Without Saving');
        dialog.add_response('cancel', 'Cancel');
        dialog.add_response('apply', 'Apply and Exit');
        dialog.set_response_appearance('discard', Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.set_response_appearance('apply', Adw.ResponseAppearance.SUGGESTED);
        this._closeDialog = dialog;
        dialog.choose(this, null, (source, result) => {
            let response = 'cancel';
            try {
                response = source.choose_finish(result);
            } catch (error) {
                console.debug(`[True Screen] Close dialog dismissed: ${error.message}`);
            }
            this._closeDialog = null;
            if (response === 'discard')
                this._finishClose();
            else if (response === 'apply' && this._apply())
                this._finishClose();
        });
        return true;
    }

    _teardownRuler() {
        this._closing = true;
        if (this._rulerPreviewSourceId) {
            GLib.source_remove(this._rulerPreviewSourceId);
            this._rulerPreviewSourceId = 0;
        }
        this._callRulerPreview('ClearRulerPreview', null, true);
        this._saveRulerOverlay(false);
    }

    _finishClose() {
        this._teardownRuler();
        this.close();
    }

    _apply() {
        try {
            const layout = serializeLayout(
                this._monitors,
                this._remapSwitch.get_active(),
                {
                    enabled: this._rulerSwitch.get_active(),
                    firstIndex: this._canvas.selectedMonitor()?.index ?? null,
                    secondIndex: this._comparisonIndex,
                },
                this._skipGapsSwitch.get_active(),
            );
            const path = saveLayout(layout);
            this._draftDirty = false;
            this._status.set_label(
                `Applied to desktop · cursor ${layout.enabled ? 'on' : 'off'} · ` +
                `ruler ${layout.rulerOverlay.enabled ? 'on' : 'off'} · ${path}`,
            );
            return true;
        } catch (error) {
            this._status.set_label(`Apply failed: ${error.message}`);
            console.error(error);
            return false;
        }
    }
});

const application = new Adw.Application({
    application_id: APP_ID,
    flags: Gio.ApplicationFlags.DEFAULT_FLAGS,
});
application.connect('activate', app => {
    const window = new TrueScreenWindow(app);
    window.present();
});
application.run([]);
