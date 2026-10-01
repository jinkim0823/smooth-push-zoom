// SPDX-License-Identifier: GPL-3.0-or-later
// gjs tests/source-api.js /path/to/GNOME-51.0-magnifier.js
// Executes selected, checksum-pinned upstream methods against stub scene objects.
// This checks source contracts; it is NOT a running GNOME 51 compositor test.
const {Gio, GLib} = imports.gi;
function read(path) {
    const [, bytes] = Gio.File.new_for_path(path).load_contents(null);
    return new TextDecoder().decode(bytes);
}
function assert(value, message) {
    if (!value) throw new Error(message);
}
const upstream = read(ARGV[0]);
assert(GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, upstream, -1) ===
    'd5c99e0f4f97c9a19ca3777a96d33d450b97f10c2e29d1d672ee71f0d53f99d2',
'Expected the audited GNOME 51.0 magnifier.js; review source before changing pin');
const extension = read('extension.js');
function method(source, name) {
    const match = source.match(new RegExp('^    ' + name + '\\([^\\n]*\\) \\{[\\s\\S]*?^    \\}', 'm'));
    assert(match, `Missing method: ${name}`);
    return `function ${match[0].trim()}`;
}
let pointer = [300.75, 240.125];
const world = {screen_width: 1280, screen_height: 720,
    get_pointer: () => pointer.map(Math.trunc)};
const Params = {parse: (params, defaults) => Object.assign({}, defaults, params)};
const GDesktopEnums = {MagnifierMouseTrackingMode: {NONE: 0}};
function upstreamMethod(name) {
    return new Function('global', 'Params', 'GDesktopEnums',
        `return (${method(upstream, name)});`)(world, Params, GDesktopEnums);
}
const region = {_viewPortX: 0, _viewPortY: 0, _viewPortWidth: 1280,
    _viewPortHeight: 720, _xCenter: 640, _yCenter: 360,
    _xMagFactor: 1, _yMagFactor: 1, _followingCursor: false,
    _clampScrollingAtEdges: true, _lensMode: false,
    _updateCloneGeometry(animate) { assert(!animate, 'unexpected secondary animation'); }};
for (const name of ['_changeROI', '_isFullScreen', 'getROI', 'getMagFactor'])
    region[name] = upstreamMethod(name);
const magnifier = {active: false, isActive() { return this.active; },
    _cursorTracker: {get_pointer: () => [{x: pointer[0], y: pointer[1]}, 0]}};
magnifier._getPointerPosition = upstreamMethod('_getPointerPosition');
const driver = {_magnifier: magnifier, _nativePointerTracking: true};
driver.apply = new Function('global', `return (${method(extension, '_setRegionFactor')});`)(world);
const position = () => [640 + (pointer[0] - region._xCenter) * region._xMagFactor,
    360 + (pointer[1] - region._yCenter) * region._yMagFactor];
function same(a, b, label) {
    assert(a.every((value, i) => Math.abs(value - b[i]) < 1e-8), `${label}: ${a} != ${b}`);
    print(`PASS: ${label}`);
}
region._xMagFactor = region._yMagFactor = 8;
region._xCenter = 1000; region._yCenter = 500;
driver.apply(region, 1.13); magnifier.active = true;
same(position(), pointer, '51 source: fractional anchor from inactive saved 8x ROI');
const before = position();
for (const factor of [1.2, 1.5, 2, 3]) driver.apply(region, factor);
same(position(), before, '51 source: smooth zoom preserves anchor');
for (const factor of [2.8, 2.4, 2]) driver.apply(region, factor);
same(position(), before, '51 source: zoom-out preserves anchor');
region._xCenter = 400; region._yCenter = 300;
const panned = position(); driver.apply(region, 2.5);
same(position(), panned, '51 source: panned viewport anchor');
const settled = position(); driver.apply(region, 2.5);
same(position(), settled, '51 source: repeated final apply does not drift');
pointer = [0.25, 0.5]; driver.apply(region, 1);
same([region._xCenter, region._yCenter], [640, 360], '51 source: zoom-out respects desktop bounds');
assert(method(upstream, 'startTrackingMouse').includes('position-invalidated'), 'native tracker changed');
assert(method(upstream, '_queuePointerPositionUpdate').includes('BEFORE_REDRAW'), 'native scheduling changed');
assert(method(upstream, 'setMagFactor').includes('animate: true'), 'native easing changed');
print('PASS: 51 source native tracking and easing contracts');

// The same mouse-only adapter runs on audited GNOME 51 region methods.
const balanced = new Function(`return (${method(extension, '_balancedPushCenter')});`)();
for (const factor of [2, 8]) {
    region._changeROI({xMagFactor: factor, yMagFactor: factor, xCenter: 640, yCenter: 360});
    const [x, y, w, h] = region.getROI();
    for (const [px, py, dx, dy] of [[x + 23 / factor, 360, -1 / factor, 0],
        [x + w - 23 / factor, 360, 1 / factor, 0],
        [640, y + 23 / factor, 0, -1 / factor], [640, y + h - 23 / factor, 0, 1 / factor]]) {
        magnifier.xMouse = px; magnifier.yMouse = py;
        same(balanced.call({_magnifier: magnifier, _pushMargin: 24}, region),
            [640 + dx, 360 + dy], `51 source: balanced Push ${factor}x ${dx},${dy}`);
    }
}
assert(method(upstream, '_centerFromMousePosition').includes('_centerFromPointPush'),
    '51 mouse dispatch changed');
assert(method(upstream, '_centerFromPointPush').includes('widthRoi - cursorWidth'),
    '51 native cursor-padding behavior changed');
print('PASS: 51 mouse dispatch and original asymmetric padding contracts');
