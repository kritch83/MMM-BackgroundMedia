/*
 * Playback-speed maths for MMM-BackgroundMedia's eased video motion.
 * Loaded in the browser via getScripts() and required directly by the tests.
 *
 * Easing is constant acceleration over D on-screen seconds, which covers D/2 seconds of footage.
 * Speed is set per frame so each frame takes exactly the right on-screen time; summed over a
 * zone the frames last exactly D (the sums telescope).
 */
(function (root, factory) {
	if (typeof module === "object" && module.exports) module.exports = factory();
	else root.BackgroundMediaMotion = factory();
}(typeof self !== "undefined" ? self : this, function () {
	// Chromium accepts playbackRate down to 1/16.
	const MIN_RATE = 0.0625;
	const clampRate = (rate) => Math.min(1, Math.max(MIN_RATE, rate));

	/**
	 * Braking evenly to a stop: the frame from s1 to s2 = s1 − frame seconds-left takes
	 * √(2D)·(√s1 − √s2) on screen, so its speed is (√s1 + √s2)/√(2D).
	 * @param {number} s1 footage seconds left to the stopping point
	 * @param {number} frame footage seconds per frame
	 * @param {number} D on-screen seconds the braking takes
	 * @returns {number} playbackRate
	 */
	function brakeRate (s1, frame, D) {
		if (!(D > 0) || s1 >= D / 2) return 1;
		const a = Math.max(0, s1);
		const b = Math.max(0, a - frame);
		return clampRate((Math.sqrt(a) + Math.sqrt(b)) / Math.sqrt(2 * D));
	}

	/**
	 * Speeding up evenly from a standstill (braking played backwards): the frame from p1 to
	 * p2 = p1 + frame seconds-in takes √(2D)·(√p2 − √p1), so its speed is (√p1 + √p2)/√(2D).
	 * @param {number} p1 footage seconds since the standstill
	 * @param {number} frame footage seconds per frame
	 * @param {number} D on-screen seconds the speed-up takes
	 * @returns {number} playbackRate
	 */
	function accelRate (p1, frame, D) {
		if (!(D > 0) || p1 >= D / 2) return 1;
		const a = Math.max(0, p1);
		return clampRate((Math.sqrt(a) + Math.sqrt(a + frame)) / Math.sqrt(2 * D));
	}

	/**
	 * Landmarks (footage seconds) for the "midpause" style: optional speed-up intro, brake to a
	 * stop at the pause point, hold, speed back up, and start fading out `fadeOut` before the end.
	 * Eases shrink on very short clips so zones never overlap.
	 * @param {number} L clip length in seconds
	 * @param {object} o options (seconds)
	 * @param {number} o.position pause point as a fraction of the clip
	 * @param {number} o.ease on-screen seconds per ease
	 * @param {number} o.hold seconds to hold at the pause point
	 * @param {number} o.fadeOut seconds before the end that the fade-out starts
	 * @param {boolean} o.speedup start from a standstill
	 * @returns {object} plan
	 */
	function midPausePlan (L, { position = 0.5, ease = 1, hold = 3, fadeOut = 0.25, speedup = false } = {}) {
		const m = L * Math.min(0.95, Math.max(0.05, position));
		const fadeStart = Math.max(m, L - Math.max(0, fadeOut));
		const D = Math.max(0, Math.min(ease, 2 * m, 2 * (fadeStart - m)));
		const brakeStart = m - D / 2;
		const accelEnd = m + D / 2;
		const Din = speedup ? Math.max(0, Math.min(ease, 2 * brakeStart)) : 0;
		const introEnd = Din / 2;
		const hold_ = Math.max(0, hold);
		// Each ease adds half its length on screen; the hold adds all of it.
		const screen = fadeStart + Din / 2 + D + hold_;
		return { L, m, D, Din, introEnd, brakeStart, accelEnd, fadeStart, hold: hold_, screen };
	}

	/**
	 * Speed at footage time t for a midPausePlan. `rest` is the time of the frame the video
	 * stops on (the last frame before the pause point); `afterHold` once the hold is over.
	 * @param {object} plan midPausePlan result
	 * @param {number} t footage seconds
	 * @param {number} frame footage seconds per frame
	 * @param {number} rest stopping frame time
	 * @param {boolean} afterHold the hold has finished
	 * @returns {number} playbackRate
	 */
	function midPauseRate (plan, t, frame, rest, afterHold) {
		if (plan.Din > 0 && t < plan.introEnd) return accelRate(t, frame, plan.Din);
		if (!afterHold) return t >= rest - plan.D / 2 ? brakeRate(rest - t, frame, plan.D) : 1;
		return accelRate(t - rest, frame, plan.D);
	}

	return { MIN_RATE, brakeRate, accelRate, midPausePlan, midPauseRate };
}));
