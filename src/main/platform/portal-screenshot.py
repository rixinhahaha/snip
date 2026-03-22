#!/usr/bin/env python3
"""XDG Desktop Portal screenshot helper.

Uses a single D-Bus connection so the Response signal is delivered correctly.
Outputs JSON: {"uri": "file:///..."} on success, {"cancelled": true} on cancel,
or {"error": "message"} on failure.
"""
import json, sys, os

try:
    import gi
    gi.require_version('Gio', '2.0')
    from gi.repository import Gio, GLib
except Exception as e:
    print(json.dumps({"error": "gi not available: " + str(e)}))
    sys.exit(1)

interactive = '--interactive' in sys.argv

try:
    bus = Gio.bus_get_sync(Gio.BusType.SESSION)
except Exception as e:
    print(json.dumps({"error": "D-Bus connect failed: " + str(e)}))
    sys.exit(1)

token = 'snip_' + str(os.getpid())
result = [None]
loop = GLib.MainLoop()

def on_response(connection, sender, path, iface, signal, params):
    response_code = params[0]
    if response_code == 0:
        details = params[1]
        uri = details.get('uri', None)
        if uri:
            result[0] = {"uri": uri.get_string() if hasattr(uri, 'get_string') else str(uri)}
        else:
            result[0] = {"error": "No URI in response"}
    else:
        result[0] = {"cancelled": True}
    loop.quit()

bus.signal_subscribe(
    'org.freedesktop.portal.Desktop',
    'org.freedesktop.portal.Request',
    'Response',
    None, None,
    Gio.DBusSignalFlags.NO_MATCH_RULE,
    on_response
)

try:
    reply = bus.call_sync(
        'org.freedesktop.portal.Desktop',
        '/org/freedesktop/portal/desktop',
        'org.freedesktop.portal.Screenshot',
        'Screenshot',
        GLib.Variant('(sa{sv})', ('', {
            'handle_token': GLib.Variant('s', token),
            'interactive': GLib.Variant('b', interactive)
        })),
        None, Gio.DBusCallFlags.NONE, -1, None
    )
except Exception as e:
    print(json.dumps({"error": "Screenshot call failed: " + str(e)}))
    sys.exit(1)

GLib.timeout_add_seconds(60, lambda: (result.__setitem__(0, {"error": "Timeout"}), loop.quit(), False)[-1])
loop.run()

print(json.dumps(result[0] or {"error": "No response"}))
