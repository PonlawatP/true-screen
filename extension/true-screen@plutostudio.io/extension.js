import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const DEV_BUS_NAME = 'io.plutostudio.TrueScreen.Development';
const DEV_BUS_PATH = '/io/plutostudio/TrueScreen/Development';
const DEV_BUS_INTERFACE = 'io.plutostudio.TrueScreen.Development';

const DEV_DBUS_XML = `
<node>
  <interface name="${DEV_BUS_INTERFACE}">
    <method name="ReloadImplementation">
      <arg type="s" name="result" direction="out"/>
    </method>
    <method name="GetDevelopmentState">
      <arg type="s" name="state" direction="out"/>
    </method>
  </interface>
</node>`;

export default class TrueScreenExtension extends Extension {
    enable() {
        this._active = true;
        this._implementation = null;
        this._implementationVersion = null;
        this._implementationUri = null;
        this._reloadSerial = 0;
        this._lastReloadError = null;
        this._reloadPromise = null;

        this._devBusOwnerId = Gio.bus_own_name(
            Gio.BusType.SESSION,
            DEV_BUS_NAME,
            Gio.BusNameOwnerFlags.NONE,
            connection => this._exportDevelopmentInterface(connection),
            null,
            () => console.warn(`[True Screen] Could not own ${DEV_BUS_NAME}`),
        );
        this._scheduleReload('enable');
    }

    disable() {
        this._active = false;
        this._implementation?.disable();
        this._implementation = null;

        this._devDbusObject?.unexport();
        this._devDbusObject = null;
        if (this._devBusOwnerId) {
            Gio.bus_unown_name(this._devBusOwnerId);
            this._devBusOwnerId = 0;
        }
    }

    ReloadImplementation() {
        this._scheduleReload('D-Bus');
        return 'reload scheduled';
    }

    GetDevelopmentState() {
        return JSON.stringify({
            active: this._active,
            loaded: this._implementation !== null,
            implementationVersion: this._implementationVersion,
            implementationUri: this._implementationUri,
            reloadSerial: this._reloadSerial,
            reloadInProgress: this._reloadPromise !== null,
            lastReloadError: this._lastReloadError,
        });
    }

    GetState() {
        return this._requireImplementation().GetState();
    }

    WarpToNextMonitor() {
        return this._requireImplementation().WarpToNextMonitor();
    }

    WarpToPoint(x, y) {
        return this._requireImplementation().WarpToPoint(x, y);
    }

    SetMotionTrackingEnabled(enabled) {
        this._requireImplementation().SetMotionTrackingEnabled(enabled);
    }

    _requireImplementation() {
        if (!this._implementation)
            throw new Error('True Screen implementation is still loading');
        return this._implementation;
    }

    _exportDevelopmentInterface(connection) {
        if (!this._active)
            return;
        this._devDbusObject = Gio.DBusExportedObject.wrapJSObject(
            DEV_DBUS_XML,
            this,
        );
        this._devDbusObject.export(connection, DEV_BUS_PATH);
    }

    _scheduleReload(reason) {
        if (!this._active)
            return;
        if (this._reloadPromise) {
            console.log(`[True Screen] Reload already running; ignored ${reason}`);
            return;
        }

        this._reloadPromise = this._reloadImplementation(reason)
            .catch(error => {
                this._lastReloadError = error.message;
                console.error(`[True Screen] Implementation reload failed: ${error.stack}`);
            })
            .finally(() => {
                this._reloadPromise = null;
            });
    }

    async _reloadImplementation(reason) {
        const serial = ++this._reloadSerial;
        const cacheKey = `${GLib.get_monotonic_time()}-${serial}`;
        const uri = `${this.dir.get_child('implementation.js').get_uri()}` +
            `?reload=${cacheKey}`;
        const module = await import(uri);
        if (!this._active)
            return;

        const previous = this._implementation;
        previous?.disable();
        const next = new module.default();
        try {
            next.enable();
        } catch (error) {
            try {
                previous?.enable();
                this._implementation = previous;
            } catch (restoreError) {
                console.error(`[True Screen] Could not restore old implementation: ${restoreError.stack}`);
            }
            throw error;
        }

        this._implementation = next;
        this._implementationVersion = module.IMPLEMENTATION_VERSION ?? null;
        this._implementationUri = uri;
        this._lastReloadError = null;
        console.log(
            `[True Screen] Loaded implementation ${this._implementationVersion} ` +
            `(${reason}, serial ${serial})`,
        );
    }
}
