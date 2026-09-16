// SPDX-License-Identifier: GPL-3.0-or-later
// Offline 60 fps illustration rendered by an isolated GNOME compositor.
// Fixed simulation steps; capture wall time is not a performance measurement.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export async function captureDemo(zoom, pointer, wait, directory) {
    GLib.mkdir_with_parents(directory, 0o755);
    const appSettings = zoom._a11yAppSettings;
    appSettings.set_boolean('screen-magnifier-enabled', false);
    zoom._settings.set_double('smoothing-ms', 90);
    await wait(100);
    const board = new St.Widget({x: 0, y: 32, width: 1280, height: 928,
        style: 'background-color: #10232d;'});
    function label(text, x, y, size, color = '#e8f4f5') {
        const actor = new St.Label({text, x, y, style: `font-size: ${size}px; color: ${color};`});
        board.add_child(actor);
    }
    label('Smooth Push Zoom', 70, 60, 38);
    label('Cursor-anchored zoom. Push at the edges to pan.', 70, 120, 21, '#a5c3c8');
    label('GNOME 46 · offline 60 fps illustration · software rendering', 70, 840, 16, '#a5c3c8');
    for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 4; col++) {
            const x = 70 + col * 285, y = 220 + row * 180;
            const tile = new St.Widget({x, y, width: 255, height: 150,
                style: 'background-color: #21404b; border: 1px solid #4e7680; border-radius: 12px;'});
            board.add_child(tile);
            label(`${String.fromCharCode(65 + row)}${col + 1}`, x + 22, y + 22, 25, '#69ded1');
            label('Keep this point in view', x + 22, y + 76, 15);
        }
    }
    Main.uiGroup.add_child(board);
    pointer.notify_absolute_motion(GLib.get_monotonic_time(), 300, 320);
    await wait(150);
    const screenshot = new Shell.Screenshot();
    const fps = 60;
    const frameCount = 600;
    const trace = [];
    let wasTweening = false;
    const smooth = t => t * t * t * (t * (t * 6 - 15) + 10);
    let target = 1;
    zoom._stopAnimation();
    zoom._setZoomState(1);
    try {
        for (let frame = 0; frame < frameCount; frame++) {
            // One continuous target trajectory, with zero velocity and
            // acceleration at both endpoints. No isolated wheel-tick pauses.
            const zoomingIn = frame >= 60 && frame <= 210;
            const zoomingOut = frame >= 420 && frame <= 570;
            if (zoomingIn)
                target = Math.exp(Math.log(2.05) * smooth((frame - 60) / 150));
            if (zoomingOut)
                target = Math.exp(Math.log(2.05) * (1 - smooth((frame - 420) / 150)));
            if (frame >= 270 && frame <= 390) {
                const t = (frame - 270) / 120;
                const eased = smooth(t);
                pointer.notify_absolute_motion(GLib.get_monotonic_time(), 300 + 600 * eased, 320);
            }
            // Advance the illustrated zoom by exactly 1/60 second, regardless
            // of PNG encoding speed. Render actual magnifier geometry for each
            // step; do not duplicate/interpolate old video frames to claim 60fps.
            zoom._targetZoom = target;
            const alpha = 1 - Math.exp(-3 * (1000 / fps) / 90);
            zoom._currentZoom += (target - zoom._currentZoom) * alpha;
            if (zoomingIn || zoomingOut || Math.abs(target - zoom._currentZoom) > 0.0015) {
                zoom._applyZoom(zoom._currentZoom);
                wasTweening = true;
            } else if (wasTweening) {
                // Persist once per finished gesture, never during small
                // continuous deltas: per-frame rounding creates visible stairs.
                zoom._finishAnimation();
                target = zoom._targetZoom;
                wasTweening = false;
            }
            await wait(1);
            const path = GLib.build_filenamev([directory, `frame-${String(frame).padStart(3, '0')}.png`]);
            const stream = Gio.File.new_for_path(path).replace(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            await screenshot.screenshot(true, stream);
            stream.close(null);
            const region = Main.magnifier.getZoomRegions()[0];
            trace.push({frame, target, current: zoom._currentZoom,
                active: Main.magnifier.isActive(), roi: region.getROI()});
        }
        GLib.file_set_contents(GLib.build_filenamev([directory, 'trajectory.json']), JSON.stringify(trace));
    } finally {
        board.destroy();
    }
}
