// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class SmoothPushZoomPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(720, 820);
        const page = new Adw.PreferencesPage({title: _('Zoom'), icon_name: 'zoom-in-symbolic'});
        window.add(page);

        const shortcutGroup = new Adw.PreferencesGroup({
            title: _('Shortcut'),
            description: _('Hold the selected modifier and scroll to zoom the whole desktop.'),
        });
        page.add(shortcutGroup);

        const optionItems = ['super-alt', 'ctrl-super', 'super', 'alt'];
        const optionLabels = [
            'Super + Alt + Scroll',
            'Ctrl + Super + Scroll',
            'Super + Scroll',
            'Alt + Scroll',
        ];

        const shortcutRow = new Adw.ComboRow({
            title: _('Zoom shortcut'),
            subtitle: _('Super + Scroll may conflict with GNOME workspace switching.'),
            model: new Gtk.StringList({strings: optionLabels}),
        });
        shortcutGroup.add(shortcutRow);

        let selected = optionItems.indexOf(settings.get_string('modifier-key'));
        if (selected < 0)
            selected = 0;
        shortcutRow.set_selected(selected);
        shortcutRow.connect('notify::selected', () => {
            const i = shortcutRow.get_selected();
            if (i >= 0 && i < optionItems.length)
                settings.set_string('modifier-key', optionItems[i]);
        });
        const shortcutChangedId = settings.connect('changed::modifier-key', () => {
            const index = optionItems.indexOf(settings.get_string('modifier-key'));
            shortcutRow.set_selected(Math.max(0, index));
        });
        window.connect('close-request', () => {
            settings.disconnect(shortcutChangedId);
            return false;
        });

        const behaviorGroup = new Adw.PreferencesGroup({
            title: _('Zoom feel'),
            description: _('Choose camera tracking and edge behavior on the Camera page.'),
        });
        page.add(behaviorGroup);

        const sensitivityRow = new Adw.SpinRow({
            title: _('Zoom speed'),
            subtitle: _('0.12 gives about 12.7% zoom-in per wheel step.'),
            adjustment: new Gtk.Adjustment({
                lower: 0.01,
                upper: 0.50,
                step_increment: 0.01,
                page_increment: 0.05,
            }),
            digits: 2,
        });
        behaviorGroup.add(sensitivityRow);
        settings.bind('zoom-sensitivity', sensitivityRow, 'value', Gio.SettingsBindFlags.DEFAULT);

        const smoothingRow = new Adw.SpinRow({
            title: _('Smoothing (ms)'),
            subtitle: _('Time to cover about 95% of the change. Zero applies immediately.'),
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 300,
                step_increment: 10,
                page_increment: 50,
            }),
            digits: 0,
        });
        behaviorGroup.add(smoothingRow);
        settings.bind('smoothing-ms', smoothingRow, 'value', Gio.SettingsBindFlags.DEFAULT);

        const maxZoomRow = new Adw.SpinRow({
            title: _('Maximum zoom'),
            subtitle: _('Lowering this limit also reduces the current zoom when needed.'),
            adjustment: new Gtk.Adjustment({
                lower: 1.25,
                upper: 20.0,
                step_increment: 0.25,
                page_increment: 1.0,
            }),
            digits: 2,
        });
        behaviorGroup.add(maxZoomRow);
        settings.bind('max-zoom', maxZoomRow, 'value', Gio.SettingsBindFlags.DEFAULT);

        const pointerRow = new Adw.SwitchRow({
            title: _('Responsive magnified pointer'),
            subtitle: _('Adds frame-based tracking on older GNOME. GNOME 51 uses native tracking automatically; this switch has no effect there.'),
        });
        behaviorGroup.add(pointerRow);
        settings.bind('low-latency-pointer', pointerRow, 'active', Gio.SettingsBindFlags.DEFAULT);

        const behaviorInfo = new Adw.ActionRow({
            title: _('Zoom-out endpoint'),
            subtitle: _('At 1.00×, Desktop Zoom is OFF. Disabling this extension keeps the current zoom.'),
        });
        behaviorGroup.add(behaviorInfo);
        this._addCameraPage(window, settings);
    }

    _addCameraPage(window, settings) {
        const native = new Gio.Settings({schema_id: 'org.gnome.desktop.a11y.magnifier'});
        const page = new Adw.PreferencesPage({
            name: 'camera', title: _('Camera'), icon_name: 'input-mouse-symbolic',
        });
        window.add(page);
        const tracking = new Adw.PreferencesGroup({
            title: _('GNOME tracking'),
            description: _('These are shared GNOME Accessibility settings. Changes apply immediately and remain when the extension is disabled. Opening this page does not change them.'),
        });
        page.add(tracking);
        const items = ['push', 'proportional', 'centered', 'none'];
        const labels = [_('Push at edges'), _('Proportional'), _('Centered'), _('No tracking')];
        const connections = [];
        for (const [key, title, subtitle] of [
            ['mouse-tracking', _('Mouse tracking'), _('Push: move at the edge. Proportional: follow across the screen. Centered: keep the pointer in the middle. None: stop mouse panning.')],
            ['focus-tracking', _('Keyboard focus tracking'), _('Follow the focused control, for example when pressing Tab. Independent of mouse tracking.')],
            ['caret-tracking', _('Text cursor tracking'), _('Follow the insertion point while typing. Independent of mouse tracking.')],
        ]) {
            const row = new Adw.ComboRow({title, subtitle,
                model: new Gtk.StringList({strings: labels})});
            const sync = () => row.set_selected(Math.max(0, items.indexOf(native.get_string(key))));
            sync();
            row.connect('notify::selected', () => {
                const value = items[row.get_selected()];
                if (value !== undefined && value !== native.get_string(key))
                    native.set_string(key, value);
            });
            connections.push([native, native.connect(`changed::${key}`, sync)]);
            tracking.add(row);
        }
        const edges = new Adw.PreferencesGroup({title: _('Push borders')});
        page.add(edges);
        const balanced = new Adw.SwitchRow({
            title: _('Equal borders on all sides'),
            subtitle: _('Full-screen Push only. Removes GNOME’s extra right/bottom cursor padding. Off restores native Push.'),
        });
        edges.add(balanced);
        settings.bind('balanced-push', balanced, 'active', Gio.SettingsBindFlags.DEFAULT);
        const margin = new Adw.SpinRow({
            title: _('Edge margin (px)'),
            subtitle: _('Start panning this far inside each edge. 0 means the edge itself. Stays the same size at every zoom level.'),
            adjustment: new Gtk.Adjustment({lower: 0, upper: 200,
                step_increment: 4, page_increment: 24}), digits: 0,
        });
        edges.add(margin);
        settings.bind('push-margin', margin, 'value', Gio.SettingsBindFlags.DEFAULT);
        const syncSensitivity = () => {
            const push = native.get_string('mouse-tracking') === 'push' &&
                native.get_string('screen-position') === 'full-screen';
            balanced.set_sensitive(push);
            margin.set_sensitive(push && settings.get_boolean('balanced-push'));
        };
        for (const [object, key] of [[native, 'mouse-tracking'], [native, 'screen-position'],
            [settings, 'balanced-push']])
            connections.push([object, object.connect(`changed::${key}`, syncSensitivity)]);
        syncSensitivity();
        const bounds = new Adw.PreferencesGroup({title: _('Desktop limits')});
        page.add(bounds);
        const beyond = new Adw.SwitchRow({
            title: _('Allow scrolling beyond desktop edges'),
            subtitle: _('Shared GNOME setting. Keeps tracking near the desktop boundary but can reveal empty space, especially with Centered tracking.'),
        });
        bounds.add(beyond);
        native.bind('scroll-at-edges', beyond, 'active', Gio.SettingsBindFlags.DEFAULT);
        window.connect('close-request', () => {
            for (const [object, id] of connections)
                object.disconnect(id);
            return false;
        });
    }
}
