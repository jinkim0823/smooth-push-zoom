// SPDX-License-Identifier: GPL-3.0-or-later

// Pure geometry used by the extension. Points are [x, y] in stage
// coordinates; ROI and frame rectangles are [x, y, width, height].

// ROI centre that keeps the content under `pointer` in place when the
// magnification changes from `oldFactor` to `newFactor`.
export function anchoredCenter(pointer, center, oldFactor, newFactor) {
    return pointer.map((p, i) => p + (center[i] - p) * oldFactor / newFactor);
}

// Push tracking with the same visible margin on all four edges. The margin is
// in screen pixels, so it is divided by the zoom factor.
export function balancedPushCenter(roi, factor, margin, pointer) {
    const [x, y, width, height] = roi;
    const mx = Math.min(margin / factor, width * 0.45);
    const my = Math.min(margin / factor, height * 0.45);
    const [px, py] = pointer;
    const dx = px - Math.max(x + mx, Math.min(x + width - mx, px));
    const dy = py - Math.max(y + my, Math.min(y + height - my, py));
    return [x + width / 2 + dx, y + height / 2 + dy];
}

// GNOME's proportional tracking, applied to one monitor instead of the stage.
export function proportionalCenter(frame, roi, factor, pointer) {
    const [fx, fy, fw, fh] = frame;
    const [, , width, height] = roi;
    const padding = Math.min(fw, fh) / 5 / factor;
    const [px, py] = pointer;
    return [
        px - (px - fx - fw / 2) / (fw / 2) * (width / 2 - padding),
        py - (py - fy - fh / 2) / (fh / 2) * (height / 2 - padding),
    ];
}

// ROI centre moved inside `frame`, or null when it is already inside.
export function clampedCenter(roi, frame) {
    const [x, y, width, height] = roi;
    const [fx, fy, fw, fh] = frame;
    const clamp = (value, low, high) =>
        low > high ? (low + high) / 2 : Math.max(low, Math.min(high, value));
    const cx = clamp(x + width / 2, fx + width / 2, fx + fw - width / 2);
    const cy = clamp(y + height / 2, fy + height / 2, fy + fh - height / 2);
    if (Math.abs(cx - x - width / 2) < 1e-6 && Math.abs(cy - y - height / 2) < 1e-6)
        return null;
    return [cx, cy];
}

// Monitor containing the point, or the nearest one for a point on a seam.
export function monitorAt(monitors, x, y) {
    const distance = m => Math.hypot(
        Math.max(m.x - x, 0, x - (m.x + m.width - 1)),
        Math.max(m.y - y, 0, y - (m.y + m.height - 1)));
    return monitors.reduce((best, m) => distance(m) < distance(best) ? m : best);
}
