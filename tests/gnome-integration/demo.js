// SPDX-License-Identifier: GPL-3.0-or-later
// Demo frames rendered by a headless GNOME session at a fixed 60 fps. Input is
// scripted to look like a person: wheel ticks in uneven bursts and a mouse path
// with curvature, overshoot and a little tremor. The zoom follows the same
// target and smoothing rules as extension.js.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const FPS = 60;
const DURATION_MS = 11500;

function random(seed) {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Wheel ticks: [time ms, +1 zoom in / -1 zoom out].
function wheelTicks(rand) {
    const ticks = [];
    const burst = (start, count, interval, direction) => {
        let t = start;
        for (let i = 0; i < count; i++) {
            ticks.push([Math.round(t), direction]);
            t += interval * (0.65 + 0.7 * rand());
        }
    };
    burst(700, 4, 80, 1);
    burst(1450, 3, 95, 1);
    burst(5900, 2, 110, 1);
    burst(8300, 12, 48, -1);
    return ticks;
}

// Mouse path through a few strokes.
function mousePath(rand) {
    const strokes = [
        // start ms, end ms, from, to, overshoot px, sideways bend px
        [0, 600, [262, 338], [300, 322], 0, 4],
        [2900, 4300, [300, 322], [1000, 330], 18, -22],
        [4500, 5200, [1000, 330], [935, 470], 6, 10],
        [6800, 7700, [935, 470], [690, 415], 10, 16],
    ];
    const smooth = u => u * u * u * (u * (u * 6 - 15) + 10);
    let tremor = [0, 0];
    return t => {
        let point = strokes[0][2];
        for (const [start, end, from, to, overshoot, bend] of strokes) {
            if (t < start)
                break;
            const u = Math.min(1, (t - start) / (end - start));
            const dx = to[0] - from[0], dy = to[1] - from[1];
            const length = Math.hypot(dx, dy) || 1;
            // Most of the way in one stroke, past the target, then a correction.
            const main = smooth(Math.min(1, u / 0.8)) * (1 + overshoot / length);
            const back = u > 0.8 ? smooth((u - 0.8) / 0.2) * overshoot / length : 0;
            const along = main - back;
            const side = bend * Math.sin(Math.PI * Math.min(1, u / 0.8));
            point = [from[0] + dx * along - dy / length * side, from[1] + dy * along + dx / length * side];
        }
        tremor = tremor.map(v => v * 0.85 + (rand() - 0.5) * 0.6);
        return [Math.round(point[0] + tremor[0]), Math.round(point[1] + tremor[1])];
    };
}

function addBoard() {
    const board = new St.Widget({x: 0, y: 32, width: 1280, height: 928, style: 'background-color: #10232d;'});
    const label = (text, x, y, size, color = '#e8f4f5') =>
        board.add_child(new St.Label({text, x, y, style: `font-size: ${size}px; color: ${color};`}));
    label('Smooth Push Zoom', 70, 60, 38);
    label('Cursor-anchored zoom. Push at the edges to pan.', 70, 120, 21, '#a5c3c8');
    label('GNOME 46 · headless session · scripted input', 70, 840, 16, '#a5c3c8');
    for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 4; col++) {
            const x = 70 + col * 285, y = 220 + row * 180;
            board.add_child(new St.Widget({x, y, width: 255, height: 150,
                style: 'background-color: #21404b; border: 1px solid #4e7680; border-radius: 12px;'}));
            label(`${String.fromCharCode(65 + row)}${col + 1}`, x + 22, y + 22, 25, '#69ded1');
            label('Keep this point in view', x + 22, y + 76, 15);
        }
    }
    Main.uiGroup.add_child(board);
    return board;
}

export async function captureDemo(zoom, pointer, wait, directory) {
    GLib.mkdir_with_parents(directory, 0o755);
    zoom._a11yAppSettings.set_boolean('screen-magnifier-enabled', false);
    zoom._settings.set_double('smoothing-ms', 90);
    await wait(100);
    const rand = random(46);
    const ticks = wheelTicks(rand);
    const path = mousePath(rand);
    const board = addBoard();
    const screenshot = new Shell.Screenshot();
    const frameMs = 1000 / FPS;
    const alpha = 1 - Math.exp(-3 * frameMs / zoom._smoothingMs);
    const trace = [];
    let nextTick = 0;
    let animating = false;
    zoom._stopAnimation();
    zoom._setZoomState(1);
    try {
        for (let frame = 0; frame * frameMs < DURATION_MS; frame++) {
            const t = frame * frameMs;
            const [x, y] = path(t);
            pointer.notify_absolute_motion(GLib.get_monotonic_time(), x, y);
            await wait(1);
            // Same target rule as _onCapturedEvent().
            for (; nextTick < ticks.length && ticks[nextTick][0] <= t; nextTick++) {
                if (!animating)
                    zoom._targetZoom = zoom._currentZoom;
                zoom._targetZoom = Math.max(1, Math.min(zoom._maxZoom,
                    zoom._targetZoom * Math.exp(ticks[nextTick][1] * zoom._sensitivity)));
                if (zoom._targetZoom <= 1.0015)
                    zoom._targetZoom = 1;
                animating = true;
            }
            // Same step as _animationFrame(), with a fixed 1/60 s.
            if (animating) {
                zoom._currentZoom += (zoom._targetZoom - zoom._currentZoom) * alpha;
                if (Math.abs(zoom._targetZoom - zoom._currentZoom) <= 0.0015) {
                    zoom._finishAnimation();
                    animating = false;
                } else {
                    zoom._applyZoom(zoom._currentZoom);
                }
            }
            await wait(1);
            const file = GLib.build_filenamev([directory, `frame-${String(frame).padStart(3, '0')}.png`]);
            const stream = Gio.File.new_for_path(file).replace(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            await screenshot.screenshot(true, stream);
            stream.close(null);
            trace.push({frame, pointer: [x, y], target: zoom._targetZoom, current: zoom._currentZoom,
                active: Main.magnifier.isActive(), roi: Main.magnifier.getZoomRegions()[0].getROI()});
        }
        GLib.file_set_contents(GLib.build_filenamev([directory, 'trajectory.json']),
            JSON.stringify({fps: FPS, ticks, frames: trace}));
    } finally {
        board.destroy();
    }
}
