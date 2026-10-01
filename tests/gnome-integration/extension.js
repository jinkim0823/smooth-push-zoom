import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import Smooth from '../smooth-push-zoom@jinkim0823.github.io/extension.js';
import {captureDemo} from './demo.js';

export default class Test extends Extension {
    enable() {
        this._timers = new Set();
        this._results = [];
        this._startId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
            this._startId = 0;
            this._run().then(() => this._exit(true)).catch(error => {
                this._results.push(`FAIL: ${error.stack}`);
                this._exit(false);
            });
            return GLib.SOURCE_REMOVE;
        });
    }
    _wait(ms) {
        return new Promise(resolve => {
            const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
                this._timers.delete(id); resolve(); return GLib.SOURCE_REMOVE;
            });
            this._timers.add(id);
        });
    }
    _assert(value, name) {
        if (!value) throw new Error(name);
        this._results.push(`PASS: ${name}`);
    }
    _scroll(direction = Clutter.ScrollDirection.UP) {
        return this._smooth._onCapturedEvent({
            type: () => Clutter.EventType.SCROLL,
            get_state: () => Clutter.ModifierType.MOD4_MASK | Clutter.ModifierType.MOD1_MASK,
            get_scroll_direction: () => direction,
            get_device: () => null,
            get_time: () => 0,
        });
    }
    async _run() {
        // Exit overview so the test follows an ordinary unlocked desktop frame clock.
        Main.overview.hide();
        await this._wait(500);
        const root = this.dir.get_parent().get_child('smooth-push-zoom@jinkim0823.github.io');
        const [, bytes] = root.get_child('metadata.json').load_contents(null);
        const metadata = JSON.parse(new TextDecoder().decode(bytes));
        const prefsArgs = ['gjs', '-m', GLib.getenv('SPZ_PREFS_SCRIPT'), root.get_path()];
        const artifactDir = GLib.getenv('SPZ_ARTIFACT_DIR');
        if (artifactDir)
            prefsArgs.push(GLib.build_filenamev([artifactDir, 'preferences.png']));
        const prefsLauncher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
        prefsLauncher.setenv('WAYLAND_DISPLAY', 'spz-test', true);
        prefsLauncher.setenv('GDK_BACKEND', 'wayland', true);
        const prefsProcess = prefsLauncher.spawnv(prefsArgs);
        await new Promise((resolve, reject) => prefsProcess.wait_check_async(null, (proc, result) => {
            try { proc.wait_check_finish(result); resolve(); } catch (error) { reject(error); }
        }));
        this._assert(true, 'real preferences window loads and settings bind both ways');
        this._scrollEvents = [];
        this._motionEvents = 0;
        this._captureId = global.stage.connect('captured-event', (_stage, event) => {
            if (event.type() === Clutter.EventType.SCROLL)
                this._scrollEvents.push({direction: event.get_scroll_direction(), time: event.get_time()});
            if (event.type() === Clutter.EventType.MOTION)
                this._motionEvents++;
            return Clutter.EVENT_PROPAGATE;
        });
        this._smooth = new Smooth({...metadata, dir: root, path: root.get_path()});
        const originalFocusPush = Main.magnifier.getZoomRegions()[0]._centerFromPointPush;
        const originalMouseCenter = Main.magnifier.getZoomRegions()[0]._centerFromMousePosition;
        this._smooth.enable();
        const zoom = this._smooth;
        const region = Main.magnifier.getZoomRegions()[0];
        const magSettings = zoom._magnifierSettings;
        const appSettings = zoom._a11yAppSettings;
        magSettings.set_string('mouse-tracking', 'push');
        await this._wait(100);
        const tracking = region.getMouseTrackingMode();
        this._scroll();
        await this._wait(500);
        this._assert(!zoom._failed && !zoom._timeline && Main.magnifier.isActive(), 'real Clutter timeline converges and activates magnifier');
        this._assert(Math.abs(region.getMagFactor()[0] - 1.13) < .001, 'runtime factor and persisted factor agree at 1.13x');
        this._assert(region.getMouseTrackingMode() === tracking, 'GNOME push tracking survives zoom');
        this._scroll(Clutter.ScrollDirection.DOWN);
        await this._wait(500);
        this._assert(!Main.magnifier.isActive() && !appSettings.get_boolean('screen-magnifier-enabled'), 'zoom-out disables both runtime and accessibility setting');
        magSettings.set_double('mag-factor', 2.75);
        appSettings.set_boolean('screen-magnifier-enabled', true);
        await this._wait(150);
        this._scroll();
        await this._wait(500);
        this._assert(region.getMagFactor()[0] > 2.75, 'external activation starts zooming from 2.75x');
        zoom._settings.set_double('smoothing-ms', 300);
        this._scroll();
        await this._wait(40);
        appSettings.set_boolean('screen-magnifier-enabled', false);
        await this._wait(500);
        this._assert(!zoom._timeline && !Main.magnifier.isActive(), 'external OFF cancels real in-flight animation');
        magSettings.set_double('mag-factor', 8);
        appSettings.set_boolean('screen-magnifier-enabled', true);
        await this._wait(150);
        zoom._settings.set_double('max-zoom', 2);
        await this._wait(150);
        this._assert(region.getMagFactor()[0] <= 2, 'lowered limit clamps real region');
        zoom._settings.set_double('smoothing-ms', 0);
        this._scroll(Clutter.ScrollDirection.DOWN);
        this._assert(!zoom._timeline && region.getMagFactor()[0] < 2, 'zero smoothing applies immediately');
        zoom._settings.set_double('smoothing-ms', 300);
        this._scroll(Clutter.ScrollDirection.DOWN);
        await this._wait(40);
        magSettings.set_double('mag-factor', 4);
        await this._wait(500);
        this._assert(!zoom._timeline && region.getMagFactor()[0] === 4, 'external factor update wins during animation');
        zoom._settings.set_double('max-zoom', 12);
        zoom._settings.set_double('smoothing-ms', 90);
        appSettings.set_boolean('screen-magnifier-enabled', false);
        await this._wait(150);
        const seat = Clutter.get_default_backend().get_default_seat();
        const keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        const pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        this._virtualDevices = [keyboard, pointer];
        keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Super_L, Clutter.KeyState.PRESSED);
        keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Alt_L, Clutter.KeyState.PRESSED);
        await this._wait(60);
        pointer.notify_discrete_scroll(GLib.get_monotonic_time(), Clutter.ScrollDirection.UP, Clutter.ScrollSource.WHEEL);
        await this._wait(500);
        keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Alt_L, Clutter.KeyState.RELEASED);
        keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Super_L, Clutter.KeyState.RELEASED);
        this._results.push(`OBSERVED: ${JSON.stringify(this._scrollEvents)}`);
        this._assert(this._scrollEvents.length > 0, 'virtual wheel reaches actual stage event capture');
        this._assert(Math.abs(region.getMagFactor()[0] - 1.13) < .001, 'one native wheel tick is counted once across its paired events');
        await this._wait(100);
        // Disable only the test session's native polling to prove the new path
        // updates cursor position without waiting for GNOME's 60 Hz watcher.
        Main.magnifier.stopTrackingMouse();
        const oldMotions = this._motionEvents;
        pointer.notify_absolute_motion(GLib.get_monotonic_time(), 300, 300);
        await this._wait(120);
        this._assert(this._motionEvents > oldMotions, 'native virtual pointer reaches the stage');
        this._assert(Main.magnifier.xMouse === 300 && Main.magnifier.yMouse === 300,
            'frame tracking updates pointer with native polling stopped');
        this._assert(region.getMouseTrackingMode() === tracking,
            'frame tracking preserves Push mode');
        zoom._settings.set_boolean('low-latency-pointer', false);
        await this._wait(40);
        pointer.notify_absolute_motion(GLib.get_monotonic_time(), 500, 400);
        await this._wait(120);
        this._assert(Main.magnifier.xMouse === 300,
            'pointer option OFF stops supplemental tracking');
        zoom._settings.set_boolean('low-latency-pointer', true);
        pointer.notify_absolute_motion(GLib.get_monotonic_time(), 520, 410);
        await this._wait(120);
        this._assert(Main.magnifier.xMouse === 520 && Main.magnifier.yMouse === 410,
            'pointer option ON resumes frame tracking');
        Main.magnifier.startTrackingMouse();
        appSettings.set_boolean('screen-magnifier-enabled', false);
        magSettings.set_double('mag-factor', 8);
        pointer.notify_absolute_motion(GLib.get_monotonic_time(), 300, 240);
        await this._wait(120);
        const screenPosition = () => {
            const [x, y, w, h] = region.getROI();
            const [zx, zy] = region.getMagFactor();
            const [px, py] = global.get_pointer();
            return [global.screen_width / 2 + (px - x - w / 2) * zx,
                global.screen_height / 2 + (py - y - h / 2) * zy];
        };
        const samePosition = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1);
        this._scroll();
        await this._wait(500);
        this._assert(samePosition(screenPosition(), [300, 240]),
            'initial zoom anchors at off-center cursor despite saved 8x factor');
        // Wait beyond GNOME's 1-second following-cursor timeout.
        await this._wait(1100);
        const anchorBefore = screenPosition();
        for (let i = 0; i < 6; i++) this._scroll();
        await this._wait(500);
        this._assert(samePosition(screenPosition(), anchorBefore),
            'stationary cursor anchor survives smooth zoom and final settings commit');
        this._scroll(Clutter.ScrollDirection.DOWN);
        await this._wait(500);
        this._assert(samePosition(screenPosition(), anchorBefore),
            'zoom-out preserves anchor away from desktop boundary clamps');
        zoom._settings.set_double('smoothing-ms', 0);
        await this._wait(40);
        this._scroll();
        await this._wait(120);
        this._assert(samePosition(screenPosition(), anchorBefore),
            'zero-smoothing zoom preserves off-center cursor anchor');
        this._assert(region.getMouseTrackingMode() === tracking,
            'cursor-centered zoom does not change Push tracking mode');
        // Execute the installed GNOME region's mouse path with controlled ROI
        // and pointer coordinates; no compositor time elapses inside this loop.
        const savedMouse = [Main.magnifier.xMouse, Main.magnifier.yMouse];
        const roiCenter = [global.screen_width / 2, global.screen_height / 2];
        for (const factor of [2, 8]) {
            region._changeROI({xMagFactor: factor, yMagFactor: factor,
                xCenter: roiCenter[0], yCenter: roiCenter[1], animate: false});
            const [x, y, w, h] = region.getROI();
            const margin = zoom._settings.get_double('push-margin');
            const samples = [
                [x + (margin - 1) / factor, roiCenter[1], -1 / factor, 0],
                [x + w - (margin - 1) / factor, roiCenter[1], 1 / factor, 0],
                [roiCenter[0], y + (margin - 1) / factor, 0, -1 / factor],
                [roiCenter[0], y + h - (margin - 1) / factor, 0, 1 / factor],
            ];
            for (const [px, py, dx, dy] of samples) {
                Main.magnifier.xMouse = px; Main.magnifier.yMouse = py;
                const center = region._centerFromMousePosition();
                this._assert(Math.abs(center[0] - roiCenter[0] - dx) < 1e-7 &&
                    Math.abs(center[1] - roiCenter[1] - dy) < 1e-7,
                `equal visible Push border at ${factor}x, direction ${dx},${dy}`);
            }
        }
        zoom._settings.set_boolean('balanced-push', false);
        const nativeCenter = originalMouseCenter.call(region);
        this._assert(samePosition(region._centerFromMousePosition(), nativeCenter),
            'Push correction OFF delegates to native cursor-padding behavior');
        zoom._settings.set_boolean('balanced-push', true);
        this._assert(region._centerFromPointPush === originalFocusPush,
            'shared focus/caret Push method is not replaced');
        [Main.magnifier.xMouse, Main.magnifier.yMouse] = savedMouse;
        // Actual pointer input must use the corrected method as well.
        magSettings.set_double('mag-factor', 2);
        await this._wait(120);
        pointer.notify_absolute_motion(GLib.get_monotonic_time(), 640, 480);
        await this._wait(120);
        region._changeROI({xCenter: 640, yCenter: 480, animate: false});
        pointer.notify_absolute_motion(GLib.get_monotonic_time(), 950, 480);
        await this._wait(120);
        const [rx, , rw] = region.getROI();
        this._assert(Math.abs(rx + rw / 2 - 642) < 1,
            'native virtual pointer pans at corrected right margin');
        if (GLib.getenv('SPZ_DEMO_DIR'))
            await captureDemo(zoom, pointer, this._wait.bind(this), GLib.getenv('SPZ_DEMO_DIR'));
        global.stage.disconnect(this._captureId);
        this._captureId = 0;
        zoom.disable();
        this._assert(region._centerFromMousePosition === originalMouseCenter, 'disable restores actual native mouse method');
        this._assert(zoom._connections === null && zoom._timeline === null, 'real extension disable releases connections');
        this._smooth = null;
    }
    _exit(success) {
        const path = GLib.build_filenamev([GLib.get_user_cache_dir(), 'zoom-result.txt']);
        GLib.file_set_contents(path, `${success ? 'SUCCESS' : 'FAILURE'}\n${this._results.join('\n')}\n`);
        global.context.terminate();
    }
    disable() {
        if (this._captureId) global.stage.disconnect(this._captureId);
        if (this._startId) GLib.source_remove(this._startId);
        for (const id of this._timers) GLib.source_remove(id);
        this._timers.clear();
        this._smooth?.disable();
        this._smooth = null;
        this._virtualDevices = null;
    }
}
