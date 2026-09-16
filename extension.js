// SPDX-License-Identifier: GPL-3.0-or-later

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

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
            }
        });
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
                if (this._lowLatencyPointer && !this._failed && this._magnifier.isActive())
                    this._runSafely(() => this._magnifier.scrollToMousePos());
            });
        }
    }

    disable() {
        const wasAnimating = Boolean(this._timeline);
        this._stopAnimation();
        for (const [object, id] of this._connections ?? [])
            object.disconnect(id);
        this._connections = null;

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
        // Restrict this to full-screen regions: moving lenses have their own
        // viewport policy and must retain GNOME's native behavior.
        let anchor = {};
        if (region._isFullScreen()) {
            // GNOME 51's magnifier keeps fractional pointer coordinates;
            // global.get_pointer() truncates them. Use the same source as its
            // cursor actor, avoiding anchor drift under fractional scaling.
            const [px, py] = this._nativePointerTracking
                ? this._magnifier._getPointerPosition() : global.get_pointer();
            const active = this._magnifier.isActive();
            const [x, y, width, height] = region.getROI();
            const [oldX, oldY] = active ? region.getMagFactor() : [1, 1];
            // An inactive magnifier can still hold a saved, zoomed ROI.
            // The currently visible desktop is nevertheless the unzoomed one.
            const cx = active ? x + width / 2 : global.screen_width / 2;
            const cy = active ? y + height / 2 : global.screen_height / 2;
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
