import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {withSavedProfile} from './layout-profiles.js';

export function configPath() {
    return GLib.build_filenamev([
        GLib.get_user_config_dir(),
        'true-screen',
        'layout.json',
    ]);
}

export function loadLayout() {
    const file = Gio.File.new_for_path(configPath());
    try {
        const [ok, contents] = file.load_contents(null);
        if (!ok)
            return null;
        const parsed = JSON.parse(new TextDecoder().decode(contents));
        return parsed.schemaVersion === 1 ? parsed : null;
    } catch (error) {
        if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
            console.warn(`[True Screen] Could not load layout: ${error.message}`);
        return null;
    }
}

export function saveLayout(layout) {
    const path = configPath();
    const parent = Gio.File.new_for_path(GLib.path_get_dirname(path));
    try {
        parent.make_directory_with_parents(null);
    } catch (error) {
        if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
            throw error;
    }

    const file = Gio.File.new_for_path(path);
    const document = withSavedProfile(loadLayout(), layout);
    const contents = JSON.stringify(document, null, 2) + '\n';
    file.replace_contents(
        contents,
        null,
        false,
        Gio.FileCreateFlags.REPLACE_DESTINATION,
        null,
    );
    return path;
}
