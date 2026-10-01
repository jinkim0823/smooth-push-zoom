// SPDX-License-Identifier: GPL-3.0-or-later
// Run: gjs tests/runtime.js (from the project directory).
// GNOME objects are doubles here; compositor rendering needs separate testing.
const NativeGio = imports.gi.Gio;
const [, bytes] = NativeGio.File.new_for_path('extension.js').load_contents(null);
const source = new TextDecoder().decode(bytes)
    .replace(/^import .*;\n/gm, '').replace('export default class', 'return class');

function assert(condition, message = 'assertion failed') {
    if (!condition)
        throw new Error(message);
}
function near(actual, expected, tolerance = 1e-9) {
    assert(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}
function fixture({active = false, factor = 2.75, delayed = false, nativeTracking = false} = {}) {
    let now = 0;
    const queue = [];
    const timelines = new Set();
    const errors = [];
    class Emitter {
        constructor() { this.handlers = new Map(); this.nextId = 1; }
        connect(signal, callback) {
            const id = this.nextId++;
            this.handlers.set(id, [signal, callback]);
            return id;
        }
        disconnect(id) { assert(this.handlers.delete(id), 'disconnect unknown ID'); }
        emit(signal, ...args) {
            for (const [name, callback] of [...this.handlers.values()])
                if (name === signal) callback(this, ...args);
        }
    }
    class Settings extends Emitter {
        constructor(values) { super(); this.values = values; this.writes = 0; }
        get_string(key) { return this.values[key]; }
        get_double(key) { return this.values[key]; }
        get_boolean(key) { return this.values[key]; }
        set_double(key, value) { this.set(key, value); }
        set_boolean(key, value) { this.set(key, value); }
        set(key, value) {
            if (this.values[key] === value) return;
            this.values[key] = value;
            this.writes++;
            const notify = () => { this.emit(`changed::${key}`, key); this.emit('changed', key); };
            if (delayed) queue.push(notify); else notify();
        }
    }
    const settings = new Settings({'modifier-key': 'super-alt', 'zoom-sensitivity': .12,
        'smoothing-ms': 90, 'max-zoom': 12, 'low-latency-pointer': true, 'balanced-push': true, 'push-margin': 24});
    const magSettings = new Settings({'mag-factor': factor});
    const appSettings = new Settings({'screen-magnifier-enabled': active});
    const pointer = [300, 240, 0];
    const region = {factor, tracking: 'push', _followingCursor: true, calls: [],
        cx: 640, cy: 360, fullScreen: true,
        _isFullScreen() { return this.fullScreen; },
        getROI() { return [this.cx - 640 / this.factor, this.cy - 360 / this.factor,
            1280 / this.factor, 720 / this.factor]; },
        getMagFactor() { return [this.factor, this.factor]; },
        _changeROI(params) {
            assert(params.animate === false, 'nested animation');
            this.calls.push(params); this.factor = params.xMagFactor;
            if (params.xCenter !== undefined) this.cx = params.xCenter;
            if (params.yCenter !== undefined) this.cy = params.yCenter;
        }};
    const nativeCenter = () => ['native'];
    Object.setPrototypeOf(region, {_centerFromMousePosition: nativeCenter});
    const magnifier = new Emitter();
    region._magnifier = magnifier;
    region._mouseTrackingMode = 1;
    Object.assign(magnifier, {active, regions: [region],
        isActive() { return this.active; },
        setActive(value) {
            if (this.active === value) return;
            this.active = value; this.emit('active-changed', value);
        },
        pointerSamples: 0,
        scrollToMousePos() { this.pointerSamples++; },
        getZoomRegions() { return this.regions; }});
    if (nativeTracking) {
        magnifier._getPointerPosition = () => pointer.slice(0, 2);
        magnifier._queuePointerPositionUpdate = () => {};
    }
    // Mimic GNOME's separate settings consumers, registered before the extension.
    magSettings.connect('changed::mag-factor', () => {
        region.factor = Number(magSettings.get_double('mag-factor').toFixed(2));
    });
    appSettings.connect('changed::screen-magnifier-enabled', () => {
        magnifier.setActive(appSettings.get_boolean('screen-magnifier-enabled'));
    });
    class Timeline extends Emitter {
        constructor(properties) { super(); this.properties = properties; }
        start() { timelines.add(this); }
        stop() { timelines.delete(this); }
    }
    const stage = new Emitter();
    stage.redrawRequests = 0;
    stage.queue_redraw = () => stage.redrawRequests++;
    const Clutter = {Timeline, ModifierType: {MOD4_MASK: 1, MOD1_MASK: 2,
        CONTROL_MASK: 4, SHIFT_MASK: 8}, EventType: {SCROLL: 1, MOTION: 2},
    ScrollDirection: {SMOOTH: 0, UP: 1, DOWN: 2}, EVENT_PROPAGATE: 0, EVENT_STOP: 1};
    const Gio = {Settings: function ({schema_id}) {
        return schema_id.endsWith('applications') ? appSettings : magSettings;
    }};
    const GLib = {get_monotonic_time() { return now; }};
    class Extension { getSettings() { return settings; } }
    class InjectionManager {
        constructor() { this.saved = []; }
        overrideMethod(proto, name, create) {
            this.saved.push([proto, name, proto[name]]); proto[name] = create(proto[name]);
        }
        clear() { for (const [proto, name, original] of this.saved) proto[name] = original; this.saved = []; }
    }
    const GDesktopEnums = {MagnifierMouseTrackingMode: {PUSH: 1}};
    const Klass = new Function('Clutter', 'Gio', 'GLib', 'Main', 'Extension', 'global', 'console', 'InjectionManager', 'GDesktopEnums', source);
    const extension = new (Klass(Clutter, Gio, GLib, {magnifier}, Extension,
        {stage, get_pointer: () => pointer.map(Math.trunc), screen_width: 1280, screen_height: 720},
        {error(message) { errors.push(message); }}, InjectionManager, GDesktopEnums))();
    extension.enable();
    function flush() { while (queue.length) queue.shift()(); }
    function tick(ms = 16) {
        now += ms * 1000;
        for (const timeline of [...timelines]) timeline.emit('new-frame', now / 1000);
        flush();
    }
    function scroll({direction = 1, state = 3, dy = -1, type = 1, device = 'mouse', time = now} = {}) {
        return extension._onCapturedEvent({type() { return type; },
            get_state() { return state; }, get_scroll_direction() { return direction; },
            get_scroll_delta() { return [0, dy]; },
            get_device() { return device; }, get_time() { return time; }});
    }
    function settle() {
        for (let i = 0; timelines.size && i < 500; i++) tick();
        flush();
        assert(!timelines.size, 'animation failed to settle');
    }
    return {extension, settings, magSettings, appSettings, magnifier, region, timelines,
        stage, pointer, errors, tick, flush, scroll, settle};
}
let count = 0;
function test(name, callback) { callback(); print(`PASS ${++count}: ${name}`); }

test('wheel zoom converges, persists and removes frame source', () => {
    const f = fixture(); assert(f.scroll() === 1); f.settle();
    near(f.region.factor, 1.13); near(f.magSettings.get_double('mag-factor'), 1.13);
    assert(f.magnifier.active); assert(!f.extension._failed);
});
test('one wheel up then down reaches OFF despite persistence rounding', () => {
    const f = fixture(); f.scroll(); f.settle(); f.scroll({direction: 2}); f.settle();
    assert(!f.magnifier.active); near(f.magSettings.get_double('mag-factor'), 1);
});
test('external activation at 2.75x never jumps to a stale 1x baseline', () => {
    const f = fixture(); f.appSettings.set('screen-magnifier-enabled', true);
    f.scroll(); f.tick(); assert(f.region.factor > 2.75); f.settle();
});
test('external OFF during animation cancels it permanently', () => {
    const f = fixture(); f.scroll(); f.tick();
    f.appSettings.set('screen-magnifier-enabled', false); f.tick();
    assert(!f.magnifier.active && !f.timelines.size); near(f.extension._targetZoom, 1);
});
test('direct runtime OFF cancels animation without needing a settings change', () => {
    const f = fixture(); f.scroll(); f.tick(); f.magnifier.setActive(false); f.tick();
    assert(!f.magnifier.active && !f.timelines.size);
});
test('external factor change wins over an in-flight target', () => {
    const f = fixture({active: true}); f.scroll(); f.tick();
    f.magSettings.set('mag-factor', 4); f.tick();
    near(f.region.factor, 4); near(f.extension._targetZoom, 4); assert(!f.timelines.size);
});
test('idle input starts from live region factor, not the saved value', () => {
    const f = fixture({active: true}); f.region.factor = 5;
    f.scroll(); f.tick(); assert(f.region.factor > 5);
});
test('lowering maximum clamps current zoom immediately', () => {
    const f = fixture({active: true, factor: 8}); f.settings.set('max-zoom', 2);
    near(f.region.factor, 2); near(f.extension._targetZoom, 2);
});
test('lowering maximum also cancels an excessive pending target', () => {
    const f = fixture({active: true, factor: 2});
    for (let i = 0; i < 15; i++) f.scroll();
    f.tick(); f.settings.set('max-zoom', 2.25); f.settle();
    assert(f.region.factor <= 2.25 && f.extension._targetZoom <= 2.25);
});
test('non-centesimal maximum cannot be exceeded by final rounding', () => {
    const f = fixture(); f.settings.set('max-zoom', 1.255);
    for (let i = 0; i < 10; i++) f.scroll();
    f.settle(); assert(f.region.factor <= 1.255);
});
test('zero smoothing updates immediately without a frame source', () => {
    const f = fixture(); f.settings.set('smoothing-ms', 0); f.scroll();
    assert(!f.timelines.size && f.magnifier.active); near(f.region.factor, 1.13);
});
test('switching to zero smoothing finishes the active animation', () => {
    const f = fixture(); f.scroll(); f.settings.set('smoothing-ms', 0);
    assert(!f.timelines.size); near(f.region.factor, 1.13);
});
test('horizontal, zero, NaN and unrelated inputs propagate', () => {
    const f = fixture();
    for (const event of [{direction: 3}, {direction: 0, dy: 0},
        {direction: 0, dy: NaN}, {state: 0}, {state: 11}, {type: 2}])
        assert(f.scroll(event) === 0);
    assert(!f.timelines.size);
});
test('modifier combinations match exactly', () => {
    const f = fixture();
    for (const [key, state] of [['super-alt', 3], ['ctrl-super', 5], ['super', 1], ['alt', 2]]) {
        f.settings.set('modifier-key', key);
        assert(f.extension._modifierMatches(state));
        assert(!f.extension._modifierMatches(state | 8));
        assert(!f.extension._modifierMatches(7));
    }
});
test('high resolution scroll uses proportional deltas', () => {
    const a = fixture(); a.scroll(); a.settle();
    const b = fixture(); for (let i = 0; i < 10; i++) b.scroll({direction: 0, dy: -.1});
    b.settle(); near(a.region.factor, b.region.factor);
});
test('interpolation is invariant to frame rate at the same elapsed time', () => {
    const a = fixture(); a.scroll(); a.tick(16); a.tick(16);
    const b = fixture(); b.scroll(); for (let i = 0; i < 4; i++) b.tick(8);
    near(a.region.factor, b.region.factor);
});
test('rapid direction reversal reuses one timeline', () => {
    const f = fixture(); for (let i = 0; i < 20; i++) f.scroll();
    assert(f.timelines.size === 1); f.tick();
    for (let i = 0; i < 25; i++) f.scroll({direction: 2});
    f.settle(); assert(!f.magnifier.active);
});
test('frame application preserves tracking mode and does not persist each frame', () => {
    const f = fixture(); f.scroll(); f.tick(); const writes = f.magSettings.writes;
    f.tick(); f.tick(); assert(f.magSettings.writes === writes);
    assert(f.region.tracking === 'push');
    assert(f.region.calls.every(call => call.redoCursorTracking === false && !call.animate));
});
test('delayed self notifications do not cancel animation', () => {
    const f = fixture({delayed: true}); f.scroll(); f.tick();
    assert(f.timelines.size === 1); f.settle(); near(f.region.factor, 1.13);
});
test('delayed external OFF still wins', () => {
    const f = fixture({delayed: true}); f.scroll(); f.tick();
    f.appSettings.set('screen-magnifier-enabled', false); f.flush(); f.tick();
    assert(!f.magnifier.active && !f.timelines.size);
});
test('missing regions do not swallow input or invent a zoom region', () => {
    const f = fixture(); f.magnifier.regions = [];
    assert(f.scroll() === 0 && !f.timelines.size);
});
test('runtime API failure stops animation and logs only once', () => {
    const f = fixture(); f.region._changeROI = null; f.scroll(); f.tick();
    assert(f.extension._failed && !f.timelines.size && f.errors.length === 1);
    assert(f.scroll() === 0 && f.errors.length === 1);
});
test('disable disconnects every extension signal and stops its timeline', () => {
    const f = fixture(); f.scroll(); f.tick(); f.extension.disable();
    assert(!f.timelines.size && f.stage.handlers.size === 0);
    assert(f.settings.handlers.size === 0 && f.magnifier.handlers.size === 0);
    assert(f.magSettings.handlers.size === 1 && f.appSettings.handlers.size === 1);
    assert(f.magnifier.active); // deliberate preserve-current-zoom behavior
});
test('disable after an external change never overwrites the external factor', () => {
    const f = fixture({active: true}); f.scroll(); f.tick();
    f.magSettings.set('mag-factor', 6); f.extension.disable();
    near(f.magSettings.get_double('mag-factor'), 6);
});
test('re-enable starts with clean state and no duplicated signals', () => {
    const f = fixture(); f.extension.disable(); f.extension.enable();
    assert(f.stage.handlers.size === 2); f.scroll(); f.settle();
    assert(!f.extension._failed);
});
test('paired smooth and discrete wheel events are counted only once', () => {
    const f = fixture(); f.scroll({direction: 0, dy: -1, time: 123});
    assert(f.scroll({direction: 1, time: 123}) === 1);
    f.settle(); near(f.region.factor, 1.13);
});
test('discrete events from a different device or time are retained', () => {
    const f = fixture(); f.scroll({direction: 0, time: 123});
    f.scroll({direction: 1, time: 123, device: 'other'});
    f.scroll({direction: 1, time: 124});
    f.settle(); near(f.region.factor, 1.43);
});
test('high resolution packets plus a legacy tick retain only precise deltas', () => {
    const f = fixture();
    for (let time = 1; time <= 10; time++) f.scroll({direction: 0, dy: -.1, time});
    f.scroll({direction: 1, time: 10}); f.settle(); near(f.region.factor, 1.13);
});
test('pointer motion propagates and schedules a frame only while magnified', () => {
    const f = fixture(); assert(f.scroll({type: 2}) === 0);
    assert(f.stage.redrawRequests === 0);
    f.magnifier.setActive(true); assert(f.scroll({type: 2}) === 0);
    assert(f.stage.redrawRequests === 1);
    assert(f.magnifier.pointerSamples === 0);
    f.stage.emit('before-update'); assert(f.magnifier.pointerSamples === 1);
});
test('pointer option can switch off live without scheduling redraws', () => {
    const f = fixture({active: true}); f.settings.set('low-latency-pointer', false);
    f.scroll({type: 2}); f.stage.emit('before-update');
    assert(f.stage.redrawRequests === 0 && f.magnifier.pointerSamples === 0);
    f.settings.set('low-latency-pointer', true); f.stage.emit('before-update');
    assert(f.magnifier.pointerSamples === 1);
});
test('frame sampling does not request another frame, change zoom or change tracking', () => {
    const f = fixture({active: true});
    for (let i = 0; i < 100; i++) f.stage.emit('before-update');
    assert(f.stage.redrawRequests === 0 && f.timelines.size === 0);
    near(f.region.factor, 2.75); assert(f.region.tracking === 'push');
    f.extension.disable(); f.stage.emit('before-update');
    assert(f.magnifier.pointerSamples === 100 && f.stage.handlers.size === 0);
});
function cursorScreen(f) {
    return [640 + (f.pointer[0] - f.region.cx) * f.region.factor,
        360 + (f.pointer[1] - f.region.cy) * f.region.factor];
}
test('first activation anchors at cursor despite saved inactive ROI', () => {
    const f = fixture({factor: 8}); f.region.cx = 900; f.region.cy = 500;
    f.scroll(); f.settle();
    const [x, y] = cursorScreen(f); near(x, 300); near(y, 240);
});
test('zoom in and out preserve cursor screen position from a panned ROI', () => {
    const f = fixture({active: true, factor: 3});
    f.region.cx = 400; f.region.cy = 300;
    const initial = cursorScreen(f);
    f.scroll(); f.settle();
    cursorScreen(f).forEach((v, i) => near(v, initial[i]));
    f.scroll({direction: 2}); f.settle();
    cursorScreen(f).forEach((v, i) => near(v, initial[i]));
});
test('zero smoothing preserves off-center anchor through settings commit', () => {
    const f = fixture({active: true, factor: 2}); f.settings.set('smoothing-ms', 0);
    const initial = cursorScreen(f); f.scroll();
    cursorScreen(f).forEach((v, i) => near(v, initial[i]));
});
test('stationary cursor anchoring works after GNOME following-cursor timeout', () => {
    const f = fixture({active: true, factor: 2}); f.region._followingCursor = false;
    const initial = cursorScreen(f); f.scroll(); f.settle();
    cursorScreen(f).forEach((v, i) => near(v, initial[i]));
});
test('non-fullscreen lens keeps native tracking policy', () => {
    const f = fixture({active: true}); f.region.fullScreen = false; f.scroll(); f.settle();
    assert(f.region.calls.every(p => p.redoCursorTracking === true && p.xCenter === undefined));
});
test('51 native tracking skips extra frame hook and motion redraw', () => {
    const f = fixture({active: true, nativeTracking: true});
    assert(f.extension._nativePointerTracking && f.stage.handlers.size === 1);
    f.scroll({type: 2}); f.stage.emit('before-update');
    assert(f.stage.redrawRequests === 0 && f.magnifier.pointerSamples === 0);
    f.settings.set('low-latency-pointer', false);
    f.settings.set('low-latency-pointer', true);
    f.scroll({type: 2}); assert(f.stage.redrawRequests === 0);
});
test('51 preserves fractional cursor anchor while legacy global truncates', () => {
    const f = fixture({nativeTracking: true});
    f.pointer[0] = 300.75; f.pointer[1] = 240.125;
    f.scroll(); f.settle();
    cursorScreen(f).forEach((v, i) => near(v, f.pointer[i]));
    const before = cursorScreen(f); f.scroll(); f.settle();
    cursorScreen(f).forEach((v, i) => near(v, before[i]));
});
test('51 external OFF and disable preserve native tracking implementation', () => {
    const f = fixture({nativeTracking: true});
    const nativeMethod = f.magnifier._queuePointerPositionUpdate;
    f.scroll(); f.tick(); f.appSettings.set('screen-magnifier-enabled', false);
    assert(!f.timelines.size && !f.magnifier.active);
    f.extension.disable();
    assert(f.stage.handlers.size === 0 && !f.extension._nativePointerTracking);
    assert(f.magnifier._queuePointerPositionUpdate === nativeMethod);
    f.extension.enable(); assert(f.extension._nativePointerTracking);
});
test('partial native API presence retains the 46 fallback', () => {
    const f = fixture(); f.extension.disable();
    f.magnifier._getPointerPosition = () => f.pointer;
    f.extension.enable();
    assert(!f.extension._nativePointerTracking && f.stage.handlers.size === 2);
});


test('balanced push has equal visible margins at 2x and 8x', () => {
    for (const factor of [2, 8]) {
        const f = fixture({active: true, factor});
        const [x, y, w, h] = f.region.getROI();
        for (const [px, py, dx, dy] of [
            [x + 23 / factor, 360, -1 / factor, 0],
            [x + w - 23 / factor, 360, 1 / factor, 0],
            [640, y + 23 / factor, 0, -1 / factor],
            [640, y + h - 23 / factor, 0, 1 / factor],
        ]) {
            Object.assign(f.magnifier, {xMouse: px, yMouse: py});
            const center = f.region._centerFromMousePosition();
            near(center[0], 640 + dx); near(center[1], 360 + dy);
        }
        f.extension.disable();
    }
});
test('push dead zone, zero margin and oversized margin stay well defined', () => {
    const f = fixture({active: true, factor: 20});
    Object.assign(f.magnifier, {xMouse: 640, yMouse: 360});
    f.settings.set('push-margin', 200);
    near(f.region._centerFromMousePosition()[0], 640);
    near(f.region._centerFromMousePosition()[1], 360);
    f.settings.set('push-margin', 0);
    const [x, y] = f.region.getROI();
    Object.assign(f.magnifier, {xMouse: x, yMouse: y});
    near(f.region._centerFromMousePosition()[0], 640);
    near(f.region._centerFromMousePosition()[1], 360);
    f.magnifier.xMouse -= .5;
    near(f.region._centerFromMousePosition()[0], 639.5);
});
test('native tracking remains for other modes, lenses, switch off and failure', () => {
    const f = fixture({active: true});
    f.region._mouseTrackingMode = 2;
    assert(f.region._centerFromMousePosition()[0] === 'native');
    f.region._mouseTrackingMode = 1; f.region.fullScreen = false;
    assert(f.region._centerFromMousePosition()[0] === 'native');
    f.region.fullScreen = true; f.settings.set('balanced-push', false);
    assert(f.region._centerFromMousePosition()[0] === 'native');
    f.settings.set('balanced-push', true); f.extension._failed = true;
    assert(f.region._centerFromMousePosition()[0] === 'native');
});
test('disable restores the native method and re-enable does not stack wrappers', () => {
    const f = fixture();
    f.extension.disable();
    const original = f.region._centerFromMousePosition;
    assert(original()[0] === 'native');
    f.extension.enable(); assert(f.region._centerFromMousePosition !== original);
    f.extension.disable(); assert(f.region._centerFromMousePosition === original);
});
print(`${count} runtime regression checks passed (mock GNOME objects).`);
