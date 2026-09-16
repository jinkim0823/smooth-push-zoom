// SPDX-License-Identifier: GPL-3.0-or-later
// Isolated graphical session: gjs -m tests/prefs-window.js EXTENSION_PATH [PNG_PATH]
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw';
import Graphene from 'gi://Graphene';
import System from 'system';

Gio.Resource.load('/usr/share/gnome-shell/org.gnome.Shell.Extensions.src.gresource')._register();
const dir = Gio.File.new_for_path(ARGV[0]);
const [, bytes] = dir.get_child('metadata.json').load_contents(null);
const metadata = JSON.parse(new TextDecoder().decode(bytes));
const {default: Preferences} = await import(dir.get_child('prefs.js').get_uri());
Adw.init();
const window = new Adw.PreferencesWindow({title: 'Smooth Push Zoom'});
const preferences = new Preferences({...metadata, dir, path: dir.get_path()});
const {extensionManager} = await import('resource:///org/gnome/Shell/Extensions/js/extensionsService.js');
const serialized = {path: new GLib.Variant('s', dir.get_path())};
for (const [key, value] of Object.entries(metadata))
    serialized[key] = new GLib.Variant(Array.isArray(value) ? 'as' : 's', value);
extensionManager.createExtensionObject(serialized).stateObj = preferences;
preferences.fillPreferencesWindow(window);
const settings = preferences.getSettings();
const rows = [];
function visit(widget) {
    if (widget instanceof Adw.PreferencesRow) rows.push(widget);
    for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) visit(child);
}
visit(window);
function check(condition, message) { if (!condition) throw new Error(message); }
const combo = rows.find(row => row instanceof Adw.ComboRow);
const spins = rows.filter(row => row instanceof Adw.SpinRow);
const toggle = rows.find(row => row instanceof Adw.SwitchRow);
check(combo && spins.length === 3 && toggle, 'Expected shortcut, three numbers and switch');
combo.set_selected(1);
check(settings.get_string('modifier-key') === 'ctrl-super', 'Shortcut widget -> settings');
settings.set_string('modifier-key', 'alt');
check(combo.get_selected() === 3, 'Shortcut settings -> widget');
spins[0].set_value(.15);
check(Math.abs(settings.get_double('zoom-sensitivity') - .15) < .00001, 'Sensitivity binding');
toggle.set_active(false);
check(!settings.get_boolean('low-latency-pointer'), 'Pointer toggle binding');
settings.reset('modifier-key'); settings.reset('zoom-sensitivity'); settings.reset('low-latency-pointer');
const loop = new GLib.MainLoop(null, false);
window.present();
GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, () => {
    try {
        if (ARGV[1]) {
            const paintable = new Gtk.WidgetPaintable({widget: window});
            const snapshot = new Gtk.Snapshot();
            const width = window.get_width(), height = window.get_height();
            paintable.snapshot(snapshot, width, height);
            const node = snapshot.to_node();
            const rect = new Graphene.Rect(); rect.init(0, 0, width, height);
            const texture = window.get_renderer().render_texture(node, rect);
            check(texture.save_to_png(ARGV[1]), 'PNG save');
        }
        print('PASS: real preferences load, controls and bidirectional settings');
    } catch (error) {
        printerr(error.stack); System.exit(1);
    }
    window.close(); loop.quit(); return GLib.SOURCE_REMOVE;
});
loop.run();
