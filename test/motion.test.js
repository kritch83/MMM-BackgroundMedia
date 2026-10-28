const { test } = require("node:test");
const assert = require("node:assert/strict");
const { brakeRate, accelRate, midPausePlan, midPauseRate, MIN_RATE } = require("../motion.js");

const FRAME = 1 / 30;

// On-screen seconds to play the video frames (on the 1/30 s grid) from `from` up to, but not
// including, the frame at `to`, at the rate given per frame.
const screenTime = (from, to, rateAt) => {
	let screen = 0;
	for (let k = Math.ceil(from / FRAME - 1e-9); k * FRAME < to - 1e-9; k++) screen += FRAME / rateAt(k * FRAME);
	return screen;
};

test("braking evenly over a zone lasts D on screen and ends near a standstill", () => {
	for (const D of [0.5, 1, 2]) {
		const stop = 3;
		const took = screenTime(stop - D / 2, stop, (t) => brakeRate(stop - t, FRAME, D));
		assert.ok(Math.abs(took - D) < 0.02, `D=${D}: took ${took}`);
		assert.ok(brakeRate(FRAME, FRAME, D) < 0.2, "last frame is slow");
		assert.equal(brakeRate(D, FRAME, D), 1, "full speed before the zone");
	}
});

test("speeding up evenly from a standstill lasts D on screen", () => {
	for (const D of [0.5, 1, 2]) {
		const took = screenTime(0, D / 2, (t) => accelRate(t, FRAME, D));
		assert.ok(Math.abs(took - D) < 0.02, `D=${D}: took ${took}`);
		assert.ok(accelRate(0, FRAME, D) < 0.2, "starts slow");
		assert.equal(accelRate(D, FRAME, D), 1, "full speed after the zone");
	}
});

test("rates stay inside what Chromium accepts", () => {
	for (const s of [0, 1e-6, FRAME, 0.2, 10]) {
		for (const r of [brakeRate(s, FRAME, 1), accelRate(s, FRAME, 1), brakeRate(s, FRAME, 50)]) {
			assert.ok(r >= MIN_RATE && r <= 1, `${r}`);
		}
	}
});

test("midPausePlan landmarks for a 4 s clip", () => {
	const p = midPausePlan(4, { position: 0.5, ease: 1, hold: 2, fadeOut: 0.25, speedup: true });
	assert.equal(p.m, 2);
	assert.equal(p.D, 1);
	assert.equal(p.brakeStart, 1.5);
	assert.equal(p.accelEnd, 2.5);
	assert.equal(p.fadeStart, 3.75);
	assert.equal(p.introEnd, 0.5);
	assert.equal(p.screen, 3.75 + 0.5 + 1 + 2);
});

test("midPausePlan shrinks eases on very short clips so zones never overlap", () => {
	for (const L of [0.6, 1.5, 3, 9]) {
		const p = midPausePlan(L, { position: 0.5, ease: 1, hold: 1, fadeOut: 0.25, speedup: true });
		assert.ok(p.introEnd <= p.brakeStart + 1e-9, `L=${L}: intro overlaps braking`);
		assert.ok(p.brakeStart >= 0, `L=${L}`);
		assert.ok(p.accelEnd <= p.fadeStart + 1e-9, `L=${L}: speed-up overlaps the fade`);
		assert.ok(p.fadeStart <= L, `L=${L}`);
	}
	const off = midPausePlan(4, { ease: 1, hold: 2, fadeOut: 0.25, speedup: false });
	assert.equal(off.Din, 0);
	assert.equal(off.screen, 3.75 + 1 + 2);
});

test("midPauseRate follows the plan's zones", () => {
	const p = midPausePlan(4, { position: 0.5, ease: 1, hold: 2, fadeOut: 0.25, speedup: true });
	const rest = p.m - FRAME;
	assert.ok(midPauseRate(p, 0, FRAME, rest, false) < 0.2, "speed-up intro starts slow");
	assert.equal(midPauseRate(p, 1, FRAME, rest, false), 1, "cruising");
	assert.ok(midPauseRate(p, rest - FRAME, FRAME, rest, false) < 0.2, "braking into the pause");
	assert.ok(midPauseRate(p, rest, FRAME, rest, true) < 0.2, "speeding back up after the hold");
	assert.equal(midPauseRate(p, 3, FRAME, rest, true), 1, "cruising to the end");
	const total = screenTime(0, p.fadeStart, (t) => midPauseRate(p, t, FRAME, rest, t >= rest)) + p.hold;
	assert.ok(Math.abs(total - p.screen) < 0.1, `on-screen ${total} vs plan ${p.screen}`);
});
