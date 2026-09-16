// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class SmoothPushZoomPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(720, 820);
        const page = new Adw.PreferencesPage();
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
            description: _('The magnifier keeps GNOME’s current Follow Behavior. Set it to “Pushes Contents Around” in Accessibility → Zoom.'),
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
    }
}
