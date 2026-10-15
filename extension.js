// SPDX-License-Identifier: GPL-3.0-or-later

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GDesktopEnums from 'gi://GDesktopEnums';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension, InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';

const MIN_ZOOM = 1.0;
const EPSILON = 0.0015;

export default class SmoothPushZoomExtension extends Extension {
    enable() {
        this._connections = [];
        this._timeline = null;
        this._updating = false;
        this._failed = false;
        this._expectedFactor = null;
        this._expectedEnabled = null;
        this._lastSmoothEvent = null;
        this._monitorRegions = new Set();
        this._magnifier = Main.magnifier;
        // GNOME 51 uses position-invalidated + BEFORE_REDRAW itself. Detect
        // the implementation rather than a version number (backports exist).
        this._nativePointerTracking =
            typeof this._magnifier._queuePointerPositionUpdate === 'function' &&
            typeof this._magnifier._getPointerPosition === 'function';
        this._settings = this.getSettings();
        this._a11yAppSettings = new Gio.Settings({
            schema_id: 'org.gnome.desktop.a11y.applications',
        });
        this._magnifierSettings = new Gio.Settings({
            schema_id: 'org.gnome.desktop.a11y.magnifier',
        });
        this._readSettings();
        this._syncFromRuntime();
        this._injections = new InjectionManager();
        this._runSafely(() => this._installPushTracking());

        this._connect(this._settings, 'changed', (_settings, key) => {
            this._readSettings();
            if (key === 'max-zoom') {
                if (!this._timeline)
                    this._syncFromRuntime();
                if (this._currentZoom > this._maxZoom || this._targetZoom > this._maxZoom) {
                    this._stopAnimation();
                    this._targetZoom = Math.min(this._currentZoom, this._maxZoom);
                    this._runSafely(() => this._finishAnimation());
                }
            } else if (key === 'smoothing-ms' && this._smoothingMs === 0 && this._timeline) {
                this._runSafely(() => this._finishAnimation());
            } else if (key === 'per-monitor') {
                this._runSafely(() => this._syncMonitorViewport(true));
            }
        });
        // GNOME's own handlers for these keys reset the viewport first;
        // re-apply the monitor viewport afterwards when it still applies.
        for (const key of ['screen-position', 'lens-mode']) {
            this._connect(this._magnifierSettings, `changed::${key}`, () =>
                this._runSafely(() => this._syncMonitorViewport(true)));
        }
        this._connect(Main.layoutManager, 'monitors-changed', () =>
            this._runSafely(() => this._syncMonitorViewport(true)));
        this._connect(this._magnifierSettings, 'changed::mag-factor', () => {
            const factor = this._magnifierSettings.get_double('mag-factor');
            if (factor === this._expectedFactor) {
                this._expectedFactor = null;
                return;
            }
            this._expectedFactor = null;
            if (!this._updating) {
                this._stopAnimation();
                this._setZoomState(this._magnifier.isActive() ? factor : MIN_ZOOM);
            }
        });
        this._connect(this._a11yAppSettings, 'changed::screen-magnifier-enabled', () => {
            const enabled = this._a11yAppSettings.get_boolean('screen-magnifier-enabled');
            if (enabled === this._expectedEnabled) {
                this._expectedEnabled = null;
                return;
            }
            this._expectedEnabled = null;
            if (!this._updating) {
                this._stopAnimation();
                this._setZoomState(enabled
                    ? this._magnifierSettings.get_double('mag-factor') : MIN_ZOOM);
            }
        });
        this._connect(this._magnifier, 'active-changed', () => {
            if (!this._updating) {
                this._stopAnimation();
                this._syncFromRuntime();
            }
        });
        this._connect(global.stage, 'captured-event', (_actor, event) =>
            this._onCapturedEvent(event));
        if (!this._nativePointerTracking) {
            this._connect(global.stage, 'before-update', () => {
                if (this._lowLatencyPointer && !this._failed && this._magnifier.isActive()) {
                    this._runSafely(() => {
                        this._syncMonitorViewport();
                        this._magnifier.scrollToMousePos();
                    });
                }
            });
        }
    }

    disable() {
        const wasAnimating = Boolean(this._timeline);
        this._stopAnimation();
        for (const [object, id] of this._connections ?? [])
            object.disconnect(id);
        this._connections = null;
        this._injections?.clear();
        this._injections = null;
        this._restoreMonitorViewports();

        // Keep the user's current magnification when disabling this input tool.
        // Never commit a stale state after an external change.
        if (wasAnimating && this._magnifier?.isActive()) {
            this._targetZoom = this._currentZoom;
            this._runSafely(() => this._finishAnimation());
        }
        this._settings = null;
        this._a11yAppSettings = null;
        this._magnifierSettings = null;
        this._magnifier = null;
        this._monitorRegions = null;
        this._nativePointerTracking = false;
        this._lastSmoothEvent = null;
        this._expectedFactor = null;
        this._expectedEnabled = null;
    }

    _connect(object, signal, callback) {
        this._connections.push([object, object.connect(signal, callback)]);
    }

    _readSettings() {
        this._modifierKey = this._settings.get_string('modifier-key');
        this._sensitivity = this._settings.get_double('zoom-sensitivity');
        this._smoothingMs = this._settings.get_double('smoothing-ms');
        this._maxZoom = this._settings.get_double('max-zoom');
        this._lowLatencyPointer = this._settings.get_boolean('low-latency-pointer');
        this._balancedPush = this._settings.get_boolean('balanced-push');
        this._pushMargin = this._settings.get_double('push-margin');
        this._perMonitor = this._settings.get_boolean('per-monitor');
    }

    _installPushTracking() {
        // Override only mouse tracking. GNOME's shared _centerFromPointPush()
        // also serves focus/caret events, which must keep their native policy.
        const prototypes = new Set(this._magnifier.getZoomRegions()
            .map(region => Object.getPrototypeOf(region)));
        const extension = this;
        for (const prototype of prototypes) {
            if (typeof prototype._centerFromMousePosition !== 'function')
                throw new Error('Unsupported GNOME mouse tracking API');
            this._injections.overrideMethod(prototype, '_centerFromMousePosition',
                original => function (...args) {
                    const mode = this._mouseTrackingMode;
                    const Mode = GDesktopEnums.MagnifierMouseTrackingMode;
                    if (!extension._failed && this._magnifier === extension._magnifier &&
                        extension._isScreenFrame(this)) {
                        let center = null;
                        if (mode === Mode.PUSH && extension._balancedPush) {
                            extension._runSafely(() => {
                                center = extension._balancedPushCenter(this);
                            });
                        } else if (mode === Mode.PROPORTIONAL &&
                            extension._monitorRegions.has(this)) {
                            extension._runSafely(() => {
                                center = extension._proportionalCenter(this);
                            });
                        }
                        if (center)
                            return center;
                    }
                    return original.apply(this, args);
                });
            if (typeof prototype._changeROI !== 'function' ||
                typeof prototype._updateMagViewGeometry !== 'function')
                throw new Error('Unsupported GNOME magnifier API');
            // GNOME draws a theme-coloured border around every zoom region that
            // is not the whole stage. A monitor viewport is full-screen from the
            // user's point of view, so give it the borderless full-screen style.
            this._injections.overrideMethod(prototype, '_updateMagViewGeometry',
                original => function (...args) {
                    original.apply(this, args);
                    if (this._magView && extension._monitorRegions?.has(this)) {
                        this._magView.add_style_class_name('full-screen');
                        // The St.Bin centres its clipping group at that group's
                        // natural size. GNOME sizes the group's background to the
                        // first monitor, so on a larger monitor the magnified image
                        // was offset by half the size difference. Pin it to the viewport.
                        this._magView.get_child()?.set_size(
                            this._viewPortWidth, this._viewPortHeight);
                    }
                });
            // A monitor viewport must never show another monitor or the empty
            // stage area beside a smaller monitor (GNOME issues 5751, 8101).
            // This covers mouse, focus and caret tracking alike.
            this._injections.overrideMethod(prototype, '_changeROI',
                original => function (params = {}) {
                    original.call(this, params);
                    if (extension._failed || !extension._monitorRegions?.has(this))
                        return;
                    let clamped = null;
                    extension._runSafely(() => {
                        clamped = extension._clampedCenter(this);
                    });
                    if (clamped) {
                        original.call(this, {
                            xCenter: clamped[0], yCenter: clamped[1],
                            animate: params.animate ?? false,
                        });
                    }
                });
        }
    }

    _isScreenFrame(region) {
        // The whole stage, or the single monitor this extension assigned.
        return region._isFullScreen() || this._monitorRegions.has(region);
    }

    _viewPort(region) {
        // GNOME 46/51 expose no viewport getter; keep this private access here.
        const rect = {
            x: region._viewPortX, y: region._viewPortY,
            width: region._viewPortWidth, height: region._viewPortHeight,
        };
        if (!Object.values(rect).every(Number.isFinite))
            throw new Error('Unsupported GNOME magnifier viewport API');
        return rect;
    }

    _screenFrame(region) {
        return this._monitorRegions.has(region) ? this._viewPort(region)
            : {x: 0, y: 0, width: global.screen_width, height: global.screen_height};
    }

    _clampedCenter(region) {
        const frame = this._viewPort(region);
        const [x, y, width, height] = region.getROI();
        const clamp = (value, low, high) => low > high ? (low + high) / 2
            : Math.max(low, Math.min(high, value));
        const cx = clamp(x + width / 2, frame.x + width / 2, frame.x + frame.width - width / 2);
        const cy = clamp(y + height / 2, frame.y + height / 2, frame.y + frame.height - height / 2);
        if (Math.abs(cx - (x + width / 2)) < 1e-6 && Math.abs(cy - (y + height / 2)) < 1e-6)
            return null;
        return [cx, cy];
    }

    _proportionalCenter(region) {
        // GNOME's proportional mode maps the whole stage onto the ROI. With a
        // monitor viewport, map that monitor instead.
        const frame = this._viewPort(region);
        const [, , width, height] = region.getROI();
        const [zx, zy] = region.getMagFactor();
        const padding = Math.min(frame.width, frame.height) / 5;
        const px = this._magnifier.xMouse;
        const py = this._magnifier.yMouse;
        const halfW = frame.width / 2;
        const halfH = frame.height / 2;
        return [
            px - (px - frame.x - halfW) / halfW * (width / 2 - padding / zx),
            py - (py - frame.y - halfH) / halfH * (height / 2 - padding / zy),
        ];
    }

    _monitorModeWanted() {
        if (!this._perMonitor || this._failed)
            return false;
        const monitors = Main.layoutManager.monitors ?? [];
        return monitors.length > 1 &&
            this._magnifierSettings.get_enum('screen-position') ===
                GDesktopEnums.MagnifierScreenPosition.FULL_SCREEN &&
            !this._magnifierSettings.get_boolean('lens-mode');
    }

    _monitorAt(px, py) {
        const monitors = Main.layoutManager.monitors;
        const inside = monitors.find(m => px >= m.x && px < m.x + m.width &&
            py >= m.y && py < m.y + m.height);
        if (inside)
            return inside;
        // Pointer on a seam or outside every monitor: use the nearest one.
        const distance = m => Math.hypot(
            Math.max(m.x - px, 0, px - (m.x + m.width - 1)),
            Math.max(m.y - py, 0, py - (m.y + m.height - 1)));
        return monitors.reduce((best, m) => distance(m) < distance(best) ? m : best);
    }

    _pointer() {
        return this._nativePointerTracking
            ? this._magnifier._getPointerPosition() : global.get_pointer();
    }

    _syncMonitorViewport(force = false) {
        const wanted = this._monitorModeWanted();
        if (!wanted && this._monitorRegions.size === 0)
            return;
        const [px, py] = this._pointer();
        for (const region of this._magnifier.getZoomRegions()) {
            if (!wanted) {
                this._restoreRegion(region);
                continue;
            }
            const owned = this._monitorRegions.has(region);
            // Never take over a lens or a half-screen region.
            if (!owned && !region._isFullScreen())
                continue;
            const monitor = this._monitorAt(px, py);
            const current = this._viewPort(region);
            if (owned && !force && current.x === monitor.x && current.y === monitor.y &&
                current.width === monitor.width && current.height === monitor.height)
                continue;
            this._monitorRegions.add(region);
            region.setViewPort({x: monitor.x, y: monitor.y,
                width: monitor.width, height: monitor.height});
            if (this._magnifier.isActive()) {
                // Entering another monitor: show the content under the pointer
                // at the pointer's physical position, like the first zoom step.
                const [zx, zy] = region.getMagFactor();
                region._changeROI({
                    xCenter: px - (px - monitor.x - monitor.width / 2) / zx,
                    yCenter: py - (py - monitor.y - monitor.height / 2) / zy,
                    redoCursorTracking: false,
                    animate: false,
                });
            }
        }
    }

    _restoreRegion(region) {
        if (!this._monitorRegions?.delete(region))
            return;
        // Return to GNOME's configured screen position and natural group size.
        region._magView?.get_child()?.set_size(-1, -1);
        region.setScreenPosition(this._magnifierSettings.get_enum('screen-position'));
    }

    _restoreMonitorViewports() {
        for (const region of [...this._monitorRegions ?? []])
            this._runSafely(() => this._restoreRegion(region));
    }

    _balancedPushCenter(region) {
        const [x, y, width, height] = region.getROI();
        const [zx, zy] = region.getMagFactor();
        // Margin is in visible logical pixels, not source-desktop pixels.
        // GNOME's native Push subtracts the cursor sprite only at right/bottom;
        // its apparent inset grows with zoom and differs across cursor themes.
        // Track the pointer hotspot against four equal insets instead.
        const mx = Math.min(this._pushMargin / zx, width * 0.45);
        const my = Math.min(this._pushMargin / zy, height * 0.45);
        const px = this._magnifier.xMouse;
        const py = this._magnifier.yMouse;
        const dx = px - Math.max(x + mx, Math.min(x + width - mx, px));
        const dy = py - Math.max(y + my, Math.min(y + height - my, py));
        return [x + width / 2 + dx, y + height / 2 + dy];
    }

    _setZoomState(factor) {
        this._currentZoom = Number.isFinite(factor) ? Math.max(MIN_ZOOM, factor) : MIN_ZOOM;
        this._targetZoom = this._currentZoom;
    }

    _syncFromRuntime() {
        const region = this._magnifier.getZoomRegions()[0];
        this._setZoomState(this._magnifier.isActive() && region
            ? region.getMagFactor()[0] : MIN_ZOOM);
    }

    _modifierMatches(state) {
        const superDown = (state & Clutter.ModifierType.MOD4_MASK) !== 0;
        const altDown = (state & Clutter.ModifierType.MOD1_MASK) !== 0;
        const ctrlDown = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;
        const shiftDown = (state & Clutter.ModifierType.SHIFT_MASK) !== 0;
        if (shiftDown)
            return false;
        switch (this._modifierKey) {
        case 'super':
            return superDown && !altDown && !ctrlDown;
        case 'alt':
            return altDown && !superDown && !ctrlDown;
        case 'ctrl-super':
            return ctrlDown && superDown && !altDown;
        case 'super-alt':
            return superDown && altDown && !ctrlDown;
        default:
            return false;
        }
    }

    _onCapturedEvent(event) {
        // GNOME 46 normally samples the magnified cursor using a ~60 Hz timer.
        // Request a frame on pointer motion, then sample the latest position in
        // before-update. Motion packets coalesce into frames; stationary cursors
        // create no continuous redraw loop. Keep GNOME's poller as a fallback
        // for grabs/input paths that do not reach this stage event handler.
        if (event.type() === Clutter.EventType.MOTION) {
            if (!this._failed && this._magnifier.isActive() &&
                (this._monitorRegions.size > 0 || this._perMonitor))
                this._runSafely(() => this._syncMonitorViewport());
            if (!this._nativePointerTracking && this._lowLatencyPointer &&
                !this._failed && this._magnifier.isActive())
                global.stage.queue_redraw();
            return Clutter.EVENT_PROPAGATE;
        }
        if (this._failed || event.type() !== Clutter.EventType.SCROLL ||
            !this._modifierMatches(event.get_state()))
            return Clutter.EVENT_PROPAGATE;

        let amount = 0;
        const direction = event.get_scroll_direction();
        if (direction === Clutter.ScrollDirection.SMOOTH) {
            const [, dy] = event.get_scroll_delta();
            amount = -dy;
        } else if (direction === Clutter.ScrollDirection.UP) {
            amount = 1;
        } else if (direction === Clutter.ScrollDirection.DOWN) {
            amount = -1;
        }
        // Horizontal, stop and malformed events remain available to applications.
        if (!Number.isFinite(amount) || Math.abs(amount) < 0.0001 ||
            this._magnifier.getZoomRegions().length === 0)
            return Clutter.EVENT_PROPAGATE;

        // Mutter 46 sends both smooth and discrete representations of a wheel
        // tick. Prefer its fine-grained delta, but keep standalone discrete
        // events working. Paired events share a device and timestamp.
        const device = event.get_device();
        const time = event.get_time();
        if (direction === Clutter.ScrollDirection.SMOOTH) {
            this._lastSmoothEvent = {device, time, sign: Math.sign(amount)};
        } else if (this._lastSmoothEvent?.device === device &&
            this._lastSmoothEvent.time === time &&
            this._lastSmoothEvent.sign === Math.sign(amount)) {
            return Clutter.EVENT_STOP;
        }

        const succeeded = this._runSafely(() => {
            if (!this._timeline)
                this._syncFromRuntime();
            this._targetZoom = Math.max(MIN_ZOOM, Math.min(this._maxZoom,
                this._targetZoom * Math.exp(amount * this._sensitivity)));
            if (this._targetZoom <= MIN_ZOOM + EPSILON)
                this._targetZoom = MIN_ZOOM;
            this._startAnimation();
        });
        return succeeded ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
    }

    _startAnimation() {
        if (this._smoothingMs === 0 ||
            Math.abs(this._targetZoom - this._currentZoom) <= EPSILON) {
            this._finishAnimation();
            return;
        }
        if (this._timeline)
            return;
        this._lastFrameUs = GLib.get_monotonic_time();
        this._timeline = new Clutter.Timeline({
            actor: global.stage, duration: 1000, repeat_count: -1,
        });
        this._frameId = this._timeline.connect('new-frame', () => {
            this._runSafely(() => {
                const nowUs = GLib.get_monotonic_time();
                const dtMs = Math.max(0, (nowUs - this._lastFrameUs) / 1000);
                this._lastFrameUs = nowUs;
                const alpha = this._smoothingMs === 0 ? 1
                    : 1 - Math.exp(-3 * dtMs / this._smoothingMs);
                this._currentZoom += (this._targetZoom - this._currentZoom) * alpha;
                if (Math.abs(this._targetZoom - this._currentZoom) <= EPSILON)
                    this._finishAnimation();
                else
                    this._applyZoom(this._currentZoom);
            });
        });
        this._timeline.start();
    }

    _stopAnimation() {
        if (!this._timeline)
            return;
        this._timeline.stop();
        this._timeline.disconnect(this._frameId);
        this._timeline = null;
        this._frameId = 0;
    }

    _writeFactor(factor) {
        if (this._magnifierSettings.get_double('mag-factor') !== factor) {
            this._expectedFactor = factor;
            this._magnifierSettings.set_double('mag-factor', factor);
        }
    }

    _writeEnabled(enabled) {
        if (this._a11yAppSettings.get_boolean('screen-magnifier-enabled') !== enabled) {
            this._expectedEnabled = enabled;
            this._a11yAppSettings.set_boolean('screen-magnifier-enabled', enabled);
        }
    }

    _applyZoom(factor) {
        this._updating = true;
        try {
            if (factor <= MIN_ZOOM + EPSILON) {
                this._magnifier.setActive(false);
                this._writeEnabled(false);
                return;
            }
            const regions = this._magnifier.getZoomRegions();
            if (regions.length === 0)
                throw new Error('GNOME has no zoom region');
            this._syncMonitorViewport();
            this._magnifier.scrollToMousePos();
            for (const region of regions)
                this._setRegionFactor(region, factor);
            if (!this._magnifier.isActive()) {
                // Regions already have the first factor and anchor before
                // activation. Persist only at completion: GNOME rounds setting
                // updates to 2 decimals, which would shift this first anchor.
                this._writeEnabled(true);
                this._magnifier.setActive(true);
            }
        } finally {
            this._updating = false;
        }
    }

    _setRegionFactor(region, factor) {
        // GNOME 46/51 setMagFactor() always adds a 100 ms easing animation.
        // Our frame-clock interpolation must apply immediately. Keep this one
        // private API dependency isolated; re-check it before adding Shell versions.
        // Source: GNOME/gnome-shell, 46.0 and 51.0, js/ui/magnifier.js.
        if (typeof region._changeROI !== 'function' ||
            typeof region._isFullScreen !== 'function' ||
            typeof region.getROI !== 'function' ||
            typeof region.getMagFactor !== 'function')
            throw new Error('Unsupported GNOME magnifier API');
        // Zoom about the visible cursor, independently of mouse-follow policy.
        // Keep z * (pointer - center) constant so the point under the cursor
        // does not slide across the viewport when the factor changes.
        // Restrict this to full-screen or monitor regions: moving lenses have
        // their own viewport policy and must retain GNOME's native behavior.
        let anchor = {};
        if (this._isScreenFrame(region)) {
            // GNOME 51's magnifier keeps fractional pointer coordinates;
            // global.get_pointer() truncates them. Use the same source as its
            // cursor actor, avoiding anchor drift under fractional scaling.
            const [px, py] = this._pointer();
            const active = this._magnifier.isActive();
            const [x, y, width, height] = region.getROI();
            const [oldX, oldY] = active ? region.getMagFactor() : [1, 1];
            // An inactive magnifier can still hold a saved, zoomed ROI.
            // The currently visible desktop is nevertheless the unzoomed one.
            const frame = this._screenFrame(region);
            const cx = active ? x + width / 2 : frame.x + frame.width / 2;
            const cy = active ? y + height / 2 : frame.y + frame.height / 2;
            anchor = {
                xCenter: px + (cx - px) * oldX / factor,
                yCenter: py + (cy - py) * oldY / factor,
                redoCursorTracking: false,
            };
        }
        region._changeROI({
            xMagFactor: factor, yMagFactor: factor,
            redoCursorTracking: region._followingCursor,
            ...anchor,
            animate: false,
        });
    }

    _finishAnimation() {
        this._stopAnimation();
        // GNOME reads mag-factor to two decimal places. Match that precision
        // without rounding above the cap or leaving a sticky near-1x endpoint.
        const factor = Math.min(Math.floor(this._maxZoom * 100) / 100,
            Math.max(MIN_ZOOM, Number(this._targetZoom.toFixed(2))));
        // Apply anchoring before GSettings can change the region's old factor.
        this._applyZoom(factor);
        this._setZoomState(factor);
        this._updating = true;
        try {
            this._writeFactor(factor);
            this._writeEnabled(factor > MIN_ZOOM);
        } finally {
            this._updating = false;
        }
        this._applyZoom(factor);
    }

    _runSafely(callback) {
        try {
            callback();
            return true;
        } catch (error) {
            this._stopAnimation();
            if (!this._failed)
                console.error(`[Smooth Push Zoom] ${error.stack ?? error}`);
            this._failed = true;
            return false;
        }
    }
}
