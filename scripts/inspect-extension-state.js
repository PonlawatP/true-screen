#!/usr/bin/gjs -m

import Gio from 'gi://Gio';

const result = Gio.DBus.session.call_sync(
    'io.plutostudio.TrueScreen.Spike',
    '/io/plutostudio/TrueScreen/Spike',
    'io.plutostudio.TrueScreen.Spike',
    'GetState',
    null,
    null,
    Gio.DBusCallFlags.NONE,
    3000,
    null,
).deepUnpack();

print(JSON.stringify(JSON.parse(result[0]), null, 2));
