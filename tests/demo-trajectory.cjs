// SPDX-License-Identifier: GPL-3.0-or-later
// Check the demo trajectory written by tests/gnome-integration/demo.js.
const fs = require('node:fs');
const assert = require('node:assert/strict');

const root = process.argv[2];
const {fps, ticks, frames} = JSON.parse(fs.readFileSync(`${root}/trajectory.json`));
assert.equal(fs.readdirSync(root).filter(f => /^frame-\d+\.png$/.test(f)).length, frames.length);

// The zoom only moves in the direction of the latest wheel tick, apart from the
// two-decimal rounding when it settles, and no frame jumps by more than 10% (fast zoom-out spins reach about 7%).
let direction = 0, maxStep = 0, nextTick = 0;
for (let i = 1; i < frames.length; i++) {
    for (; nextTick < ticks.length && ticks[nextTick][0] <= i * 1000 / fps; nextTick++)
        direction = ticks[nextTick][1];
    const step = Math.log(frames[i].current / frames[i - 1].current);
    assert(step * direction >= -Math.log(1.005), `zoom moved against the wheel at frame ${i}`);
    maxStep = Math.max(maxStep, Math.abs(step));
}
assert(maxStep < Math.log(1.10), `largest step ${maxStep}`);
const last = frames.at(-1);
assert(last.current === 1 && !last.active, 'zoom ends fully off');
console.log(`PASS: ${frames.length} frames, ${ticks.length} wheel ticks, ` +
    `largest step ${(Math.expm1(maxStep) * 100).toFixed(2)}%, ends off`);
