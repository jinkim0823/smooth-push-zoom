// SPDX-License-Identifier: GPL-3.0-or-later

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GDesktopEnums from 'gi://GDesktopEnums';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension, InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';

import * as Geometry from './geometry.js';

const MIN_ZOOM = 1.0;
const EPSILON = 0.0015;

// Setting value -> held modifiers, in the order _heldModifiers() lists them.
const SHORTCUTS = {
    'super-alt': 'super+alt',
    'ctrl-super': 'super+ctrl',
    'super': 'super',
    'alt': 'alt',
};

export default class SmoothPushZoomExtension extends Extension {
    enable() {
        this._connections = [];
        this._frameHookId = 0;
        this._animationId = 0;
        this._updating = false;
        this._failed = false;
        this._ownWrites = new Map();
        this._lastSmoothEvent = null;
        this._monitorRegions = new Set();
        this._magnifier = Main.magnifier;
        this._settings = this.getSettings();
        this._a11yAppSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.a11y.applications'});
        this._magnifierSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.a11y.magnifier'});
        this._readSettings();
        this._syncFromRuntime();
        this._injections = new InjectionManager();
        this._runSafely(() => this._installOverrides());

        this._connect(this._settings, 'changed', (_settings, key) => this._onSettingChanged(key));
        // GNOME resets the viewport for these first; re-apply monitor mode after it.
        for (const key of ['screen-position', 'lens-mode']) {
            this._connect(this._magnifierSettings, `changed::${key}`,
                () => this._runSafely(() => this._syncMonitorViewport(true)));
        }
        this._connect(Main.layoutManager, 'monitors-changed',
            () => this._runSafely(() => this._syncMonitorViewport(true)));
        this._connect(this._magnifierSettings, 'changed::mag-factor', () => {
            const factor = this._magnifierSettings.get_double('mag-factor');
            if (!this._isOwnWrite('mag-factor', factor) && !this._updating)
                this._resetZoom(this._magnifier.isActive() ? factor : MIN_ZOOM);
        });
        this._connect(this._a11yAppSettings, 'changed::screen-magnifier-enabled', () => {
            const enabled = this._a11yAppSettings.get_boolean('screen-magnifier-enabled');
            if (!this._isOwnWrite('screen-magnifier-enabled', enabled) && !this._updating)
                this._resetZoom(enabled ? this._magnifierSettings.get_double('mag-factor') : MIN_ZOOM);
        });
        this._connect(this._magnifier, 'active-changed', () => {
            this._syncFrameHook();
            if (!this._updating) {
                this._stopAnimation();
                this._syncFromRuntime();
            }
        });
        this._connect(global.stage, 'captured-event', (_actor, event) => this._onCapturedEvent(event));
        this._syncFrameHook();
    }

    disable() {
        // Keep the current magnification, but finish an interrupted animation
        // while the overrides and monitor viewport are still in place.
        if (this._animationId) {
            this._stopAnimation();
            if (this._magnifier.isActive()) {
                this._targetZoom = this._currentZoom;
                this._runSafely(() => this._finishAnimation());
            }
        }
        this._disconnectFrameHook();
        for (const [object, id] of this._connections)
            object.disconnect(id);
        this._connections = null;
        this._injections.clear();
        this._injections = null;
        this._restoreMonitorViewports();
        this._monitorRegions = null;
        this._ownWrites = null;
        this._lastSmoothEvent = null;
        this._settings = null;
        this._a11yAppSettings = null;
        this._magnifierSettings = null;
        this._magnifier = null;
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

    _onSettingChanged(key) {
        this._readSettings();
        this._syncFrameHook();
        if (key === 'max-zoom') {
            if (!this._animationId)
                this._syncFromRuntime();
            if (this._currentZoom > this._maxZoom || this._targetZoom > this._maxZoom) {
                this._stopAnimation();
                this._targetZoom = Math.min(this._currentZoom, this._maxZoom);
                this._runSafely(() => this._finishAnimation());
            }
        } else if (key === 'smoothing-ms' && this._smoothingMs === 0 && this._animationId) {
            this._runSafely(() => this._finishAnimation());
        } else if (key === 'per-monitor') {
            this._runSafely(() => this._syncMonitorViewport(true));
        }
    }

    // GNOME 46 polls the pointer at about 60 Hz while zoomed. This hook samples
    // it once per frame instead. It is connected only while zoom is active.
    _frameHookWanted() {
        return this._lowLatencyPointer && !this._failed && this._magnifier.isActive();
    }

    _syncFrameHook() {
        if (!this._frameHookWanted())
            this._disconnectFrameHook();
        else if (!this._frameHookId)
            this._frameHookId = global.stage.connect('before-update', () => this._onBeforeUpdate());
    }

    _disconnectFrameHook() {
        if (this._frameHookId) {
            global.stage.disconnect(this._frameHookId);
            this._frameHookId = 0;
        }
    }

    _onBeforeUpdate() {
        if (!this._frameHookWanted()) {
            this._disconnectFrameHook();
            return;
        }
        this._runSafely(() => {
            this._syncMonitorViewport();
            this._magnifier.scrollToMousePos();
        });
    }

    // Overrides on GNOME 46's private ZoomRegion methods. Each falls back to
    // the original behaviour if our code throws.
    _installOverrides() {
        const extension = this;
        const regions = this._magnifier.getZoomRegions();
        for (const region of regions) {
            for (const name of ['_centerFromMousePosition', '_changeROI', '_updateMagViewGeometry', '_isFullScreen']) {
                if (typeof region[name] !== 'function')
                    throw new Error(`ZoomRegion.${name} is missing`);
            }
            if (!Number.isFinite(region._viewPortWidth))
                throw new Error('ZoomRegion viewport fields are missing');
        }
        for (const proto of new Set(regions.map(r => Object.getPrototypeOf(r)))) {
            // Mouse tracking only: focus and caret keep GNOME's own Push.
            this._injections.overrideMethod(proto, '_centerFromMousePosition', original => function (...args) {
                let center = null;
                if (this._magnifier === extension._magnifier && !extension._failed) {
                    extension._runSafely(() => {
                        center = extension._mouseCenter(this);
                    });
                }
                return center ?? original.apply(this, args);
            });

            // Keep a monitor-mode view inside its monitor (GNOME issues 5751, 8101).
            this._injections.overrideMethod(proto, '_changeROI', original => function (params = {}) {
                original.call(this, params);
                if (!extension._monitorRegions?.has(this) || extension._failed)
                    return;
                let center = null;
                extension._runSafely(() => {
                    center = Geometry.clampedCenter(this.getROI(), extension._viewPort(this));
                });
                if (center)
                    original.call(this, {xCenter: center[0], yCenter: center[1], animate: params.animate ?? false});
            });

            // GNOME borders any non-full-screen region and sizes its clip group
            // from the first monitor; a monitor view needs neither.
            this._injections.overrideMethod(proto, '_updateMagViewGeometry', original => function (...args) {
                original.apply(this, args);
                if (this._magView && extension._monitorRegions?.has(this)) {
                    this._magView.add_style_class_name('full-screen');
                    this._magView.get_child()?.set_size(this._viewPortWidth, this._viewPortHeight);
                }
            });
        }
    }

    _mouseCenter(region) {
        if (!this._isScreenFrame(region))
            return null;
        const Mode = GDesktopEnums.MagnifierMouseTrackingMode;
        const pointer = [this._magnifier.xMouse, this._magnifier.yMouse];
        const roi = region.getROI();
        const [factor] = region.getMagFactor();
        if (region._mouseTrackingMode === Mode.PUSH && this._balancedPush)
            return Geometry.balancedPushCenter(roi, factor, this._pushMargin, pointer);
        if (region._mouseTrackingMode === Mode.PROPORTIONAL && this._monitorRegions.has(region))
            return Geometry.proportionalCenter(this._viewPort(region), roi, factor, pointer);
        return null;
    }

    // True for the whole stage or for a monitor this extension assigned.
    _isScreenFrame(region) {
        return region._isFullScreen() || this._monitorRegions.has(region);
    }

    _viewPort(region) {
        return [region._viewPortX, region._viewPortY, region._viewPortWidth, region._viewPortHeight];
    }

    _screenFrame(region) {
        return this._monitorRegions.has(region)
            ? this._viewPort(region) : [0, 0, global.screen_width, global.screen_height];
    }

    _monitorModeWanted() {
        return this._perMonitor && !this._failed &&
            Main.layoutManager.monitors.length > 1 &&
            this._magnifierSettings.get_enum('screen-position') ===
                GDesktopEnums.MagnifierScreenPosition.FULL_SCREEN &&
            !this._magnifierSettings.get_boolean('lens-mode');
    }

    // Put each full-screen region on the monitor under the pointer, or give
    // it back to GNOME when monitor mode no longer applies.
    _syncMonitorViewport(force = false) {
        const wanted = this._monitorModeWanted();
        if (!wanted && this._monitorRegions.size === 0)
            return;
        const pointer = global.get_pointer().slice(0, 2);
        const monitor = wanted ? Geometry.monitorAt(Main.layoutManager.monitors, ...pointer) : null;
        for (const region of this._magnifier.getZoomRegions()) {
            if (!wanted) {
                this._restoreRegion(region);
                continue;
            }
            const owned = this._monitorRegions.has(region);
            if (!owned && !region._isFullScreen())
                continue;
            const [x, y, width, height] = this._viewPort(region);
            if (owned && !force && x === monitor.x && y === monitor.y &&
                width === monitor.width && height === monitor.height)
                continue;
            this._monitorRegions.add(region);
            region.setViewPort({x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height});
            if (this._magnifier.isActive()) {
                // Show what is under the pointer at its physical position.
                const middle = [monitor.x + monitor.width / 2, monitor.y + monitor.height / 2];
                const [cx, cy] = Geometry.anchoredCenter(pointer, middle, 1, region.getMagFactor()[0]);
                region._changeROI({xCenter: cx, yCenter: cy, redoCursorTracking: false, animate: false});
            }
        }
    }

    _restoreRegion(region) {
        if (!this._monitorRegions.delete(region))
            return;
        region._magView?.get_child()?.set_size(-1, -1);
        region.setScreenPosition(this._magnifierSettings.get_enum('screen-position'));
    }

    _restoreMonitorViewports() {
        for (const region of [...this._monitorRegions])
            this._runSafely(() => this._restoreRegion(region));
    }

    _heldModifiers(state) {
        const M = Clutter.ModifierType;
        return [
            [M.MOD4_MASK, 'super'],
            [M.CONTROL_MASK, 'ctrl'],
            [M.MOD1_MASK, 'alt'],
            [M.SHIFT_MASK, 'shift'],
        ].filter(([mask]) => state & mask).map(([, name]) => name).join('+');
    }

    _modifierMatches(state) {
        return this._heldModifiers(state) === SHORTCUTS[this._modifierKey];
    }

    _onCapturedEvent(event) {
        const type = event.type();
        if (type === Clutter.EventType.MOTION) {
            if (!this._failed && this._magnifier.isActive())
                this._runSafely(() => this._syncMonitorViewport());
            if (this._frameHookWanted()) {
                this._syncFrameHook();
                global.stage.queue_redraw();
            }
            return Clutter.EVENT_PROPAGATE;
        }
        if (this._failed || type !== Clutter.EventType.SCROLL || !this._modifierMatches(event.get_state()))
            return Clutter.EVENT_PROPAGATE;

        const direction = event.get_scroll_direction();
        let amount = 0;
        if (direction === Clutter.ScrollDirection.SMOOTH)
            amount = -event.get_scroll_delta()[1];
        else if (direction === Clutter.ScrollDirection.UP)
            amount = 1;
        else if (direction === Clutter.ScrollDirection.DOWN)
            amount = -1;
        if (!Number.isFinite(amount) || Math.abs(amount) < 0.0001 ||
            this._magnifier.getZoomRegions().length === 0)
            return Clutter.EVENT_PROPAGATE;

        // A wheel tick arrives as a smooth event and a discrete one with the
        // same device and time. Count the smooth one.
        const device = event.get_device();
        const time = event.get_time();
        const sign = Math.sign(amount);
        if (direction === Clutter.ScrollDirection.SMOOTH) {
            this._lastSmoothEvent = {device, time, sign};
        } else if (this._lastSmoothEvent?.device === device &&
            this._lastSmoothEvent.time === time && this._lastSmoothEvent.sign === sign) {
            return Clutter.EVENT_STOP;
        }

        const ok = this._runSafely(() => {
            if (!this._animationId)
                this._syncFromRuntime();
            this._targetZoom = Math.max(MIN_ZOOM,
                Math.min(this._maxZoom, this._targetZoom * Math.exp(amount * this._sensitivity)));
            if (this._targetZoom <= MIN_ZOOM + EPSILON)
                this._targetZoom = MIN_ZOOM;
            this._startAnimation();
        });
        return ok ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
    }

    _setZoomState(factor) {
        this._currentZoom = Number.isFinite(factor) ? Math.max(MIN_ZOOM, factor) : MIN_ZOOM;
        this._targetZoom = this._currentZoom;
    }

    _resetZoom(factor) {
        this._stopAnimation();
        this._setZoomState(factor);
    }

    _syncFromRuntime() {
        const region = this._magnifier.getZoomRegions()[0];
        this._setZoomState(this._magnifier.isActive() && region ? region.getMagFactor()[0] : MIN_ZOOM);
    }

    // The animation runs from the stage's frame cycle while a change is pending.
    _startAnimation() {
        if (this._smoothingMs === 0 || Math.abs(this._targetZoom - this._currentZoom) <= EPSILON) {
            this._finishAnimation();
            return;
        }
        if (this._animationId)
            return;
        this._lastFrameUs = GLib.get_monotonic_time();
        this._animationId = global.stage.connect('before-update',
            () => this._runSafely(() => this._animationFrame()));
        // queue_redraw() would not schedule a frame on an undamaged stage.
        global.stage.schedule_update();
    }

    _animationFrame() {
        const now = GLib.get_monotonic_time();
        const dtMs = (now - this._lastFrameUs) / 1000;
        // before-update fires once per monitor; step once per frame.
        if (dtMs >= 1) {
            this._lastFrameUs = now;
            const alpha = 1 - Math.exp(-3 * dtMs / this._smoothingMs);
            this._currentZoom += (this._targetZoom - this._currentZoom) * alpha;
            if (Math.abs(this._targetZoom - this._currentZoom) <= EPSILON) {
                this._finishAnimation();
                return;
            }
            this._applyZoom(this._currentZoom);
        }
        global.stage.schedule_update();
    }

    _stopAnimation() {
        if (this._animationId) {
            global.stage.disconnect(this._animationId);
            this._animationId = 0;
        }
    }

    _finishAnimation() {
        this._stopAnimation();
        // GNOME stores mag-factor with two decimals.
        const factor = Math.min(Math.floor(this._maxZoom * 100) / 100,
            Math.max(MIN_ZOOM, Number(this._targetZoom.toFixed(2))));
        this._applyZoom(factor);
        this._setZoomState(factor);
        this._updating = true;
        try {
            this._writeFactor(factor);
            this._writeEnabled(factor > MIN_ZOOM);
        } finally {
            this._updating = false;
        }
        // GNOME's own mag-factor handler re-centres the view; anchor it again.
        this._applyZoom(factor);
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
                this._writeEnabled(true);
                this._magnifier.setActive(true);
            }
        } finally {
            this._updating = false;
        }
    }

    // Zoom about the cursor. setMagFactor() would add GNOME's 100 ms easing on
    // top of ours, so set the factor and centre directly.
    _setRegionFactor(region, factor) {
        let anchor = {};
        if (this._isScreenFrame(region)) {
            const pointer = global.get_pointer().slice(0, 2);
            const active = this._magnifier.isActive();
            // An inactive region can hold a stale ROI; the visible desktop is unzoomed.
            const [x, y, width, height] = active ? region.getROI() : this._screenFrame(region);
            const oldFactor = active ? region.getMagFactor()[0] : 1;
            const [cx, cy] = Geometry.anchoredCenter(pointer, [x + width / 2, y + height / 2], oldFactor, factor);
            anchor = {xCenter: cx, yCenter: cy, redoCursorTracking: false};
        }
        region._changeROI({
            xMagFactor: factor,
            yMagFactor: factor,
            redoCursorTracking: region._followingCursor,
            ...anchor,
            animate: false,
        });
    }

    _writeFactor(factor) {
        if (this._magnifierSettings.get_double('mag-factor') !== factor) {
            this._ownWrites.set('mag-factor', factor);
            this._magnifierSettings.set_double('mag-factor', factor);
        }
    }

    _writeEnabled(enabled) {
        if (this._a11yAppSettings.get_boolean('screen-magnifier-enabled') !== enabled) {
            this._ownWrites.set('screen-magnifier-enabled', enabled);
            this._a11yAppSettings.set_boolean('screen-magnifier-enabled', enabled);
        }
    }

    // Tell our own GSettings writes apart from changes made elsewhere.
    _isOwnWrite(key, value) {
        const own = this._ownWrites.get(key) === value;
        this._ownWrites.delete(key);
        return own;
    }

    // On an unexpected error, log once and stop handling input until re-enabled.
    _runSafely(callback) {
        try {
            callback();
            return true;
        } catch (error) {
            this._stopAnimation();
            if (!this._failed)
                console.error(`[Smooth Push Zoom] ${error.stack ?? error}`);
            this._failed = true;
            this._disconnectFrameHook();
            return false;
        }
    }
}
