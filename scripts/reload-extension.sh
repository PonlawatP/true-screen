#!/usr/bin/env bash
set -euo pipefail

development_bus='io.plutostudio.TrueScreen.Development'
development_path='/io/plutostudio/TrueScreen/Development'
development_interface='io.plutostudio.TrueScreen.Development'

gdbus call --session \
    --dest "${development_bus}" \
    --object-path "${development_path}" \
    --method "${development_interface}.ReloadImplementation"

echo 'True Screen implementation reload scheduled; GNOME Shell was not restarted.'
