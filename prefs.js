// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const SHORTCUTS = [
    ['super-alt', 'Super + Alt + Scroll'],
    ['ctrl-super', 'Ctrl + Super + Scroll'],
    ['super', 'Super + Scroll'],
    ['alt', 'Alt + Scroll'],
];
const TRACKING = ['push', 'proportional', 'centered', 'none'];

export default class SmoothPushZoomPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const native = new Gio.Settings({schema_id: 'org.gnome.desktop.a11y.magnifier'});
        const connections = [];
        window.connect('close-request', () => {
            for (const [object, id] of connections)
                object.disconnect(id);
            return false;
        });
        window.set_default_size(720, 820);
        window.add(this._zoomPage(settings, connections));
        window.add(this._cameraPage(settings, native, connections));
    }

    _zoomPage(settings, connections) {
        const page = new Adw.PreferencesPage({title: _('Zoom'), icon_name: 'zoom-in-symbolic'});

        const shortcutGroup = new Adw.PreferencesGroup({title: _('Shortcut')});
        page.add(shortcutGroup);
        const shortcut = new Adw.ComboRow({
            title: _('Zoom shortcut'),
            subtitle: _('Super + Scroll may conflict with workspace switching.'),
            model: new Gtk.StringList({strings: SHORTCUTS.map(([, label]) => label)}),
        });
        shortcutGroup.add(shortcut);
        const keys = SHORTCUTS.map(([key]) => key);
        const syncShortcut = () => shortcut.set_selected(Math.max(0, keys.indexOf(settings.get_string('modifier-key'))));
        syncShortcut();
        shortcut.connect('notify::selected', () => {
            const key = keys[shortcut.get_selected()];
            if (key && key !== settings.get_string('modifier-key'))
                settings.set_string('modifier-key', key);
        });
        connections.push([settings, settings.connect('changed::modifier-key', syncShortcut)]);

        const feel = new Adw.PreferencesGroup({title: _('Zoom feel')});
        page.add(feel);
        feel.add(this._spinRow(settings, 'zoom-sensitivity', _('Zoom speed'), 0.01, 0.5, 0.01, 2));
        feel.add(this._spinRow(settings, 'smoothing-ms', _('Smoothing (ms)'), 0, 300, 10, 0,
            _('0 applies each step immediately.')));
        feel.add(this._spinRow(settings, 'max-zoom', _('Maximum zoom'), 1.25, 20, 0.25, 2));
        const pointer = new Adw.SwitchRow({
            title: _('Responsive magnified pointer'),
            subtitle: _('Update the magnified pointer every frame.'),
        });
        feel.add(pointer);
        settings.bind('low-latency-pointer', pointer, 'active', Gio.SettingsBindFlags.DEFAULT);
        return page;
    }

    _cameraPage(settings, native, connections) {
        const page = new Adw.PreferencesPage({name: 'camera', title: _('Camera'), icon_name: 'input-mouse-symbolic'});

        const tracking = new Adw.PreferencesGroup({
            title: _('GNOME tracking'),
            description: _('Shared GNOME Accessibility settings. They stay when the extension is disabled.'),
        });
        page.add(tracking);
        const labels = [_('Push at edges'), _('Proportional'), _('Centered'), _('No tracking')];
        for (const [key, title] of [
            ['mouse-tracking', _('Mouse tracking')],
            ['focus-tracking', _('Keyboard focus tracking')],
            ['caret-tracking', _('Text cursor tracking')],
        ]) {
            const row = new Adw.ComboRow({title, model: new Gtk.StringList({strings: labels})});
            const sync = () => row.set_selected(Math.max(0, TRACKING.indexOf(native.get_string(key))));
            sync();
            row.connect('notify::selected', () => {
                const value = TRACKING[row.get_selected()];
                if (value && value !== native.get_string(key))
                    native.set_string(key, value);
            });
            connections.push([native, native.connect(`changed::${key}`, sync)]);
            tracking.add(row);
        }

        const borders = new Adw.PreferencesGroup({title: _('Push borders')});
        page.add(borders);
        const balanced = new Adw.SwitchRow({
            title: _('Equal borders on all sides'),
            subtitle: _('Off restores GNOME’s extra right and bottom padding.'),
        });
        borders.add(balanced);
        settings.bind('balanced-push', balanced, 'active', Gio.SettingsBindFlags.DEFAULT);
        const margin = this._spinRow(settings, 'push-margin', _('Edge margin (px)'), 0, 200, 4, 0,
            _('Same size at every zoom level.'));
        borders.add(margin);
        const syncSensitivity = () => {
            const push = native.get_string('mouse-tracking') === 'push' &&
                native.get_string('screen-position') === 'full-screen';
            balanced.set_sensitive(push);
            margin.set_sensitive(push && settings.get_boolean('balanced-push'));
        };
        for (const [object, key] of [[native, 'mouse-tracking'], [native, 'screen-position'], [settings, 'balanced-push']])
            connections.push([object, object.connect(`changed::${key}`, syncSensitivity)]);
        syncSensitivity();

        const limits = new Adw.PreferencesGroup({title: _('Desktop limits')});
        page.add(limits);
        const beyond = new Adw.SwitchRow({
            title: _('Allow scrolling beyond desktop edges'),
            subtitle: _('Shared GNOME setting. May show empty space.'),
        });
        limits.add(beyond);
        native.bind('scroll-at-edges', beyond, 'active', Gio.SettingsBindFlags.DEFAULT);
        const perMonitor = new Adw.SwitchRow({title: _('Zoom only the monitor under the pointer')});
        limits.add(perMonitor);
        settings.bind('per-monitor', perMonitor, 'active', Gio.SettingsBindFlags.DEFAULT);
        return page;
    }

    _spinRow(settings, key, title, lower, upper, step, digits, subtitle = '') {
        const row = new Adw.SpinRow({
            title,
            subtitle,
            digits,
            adjustment: new Gtk.Adjustment({lower, upper, step_increment: step, page_increment: step * 5}),
        });
        settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }
}
