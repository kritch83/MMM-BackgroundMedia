const fs = require("node:fs");

/*
 * Video limits per device. Anything a device can't decode smoothly in
 * Electron/Chromium (software decode on both Pis) gets transcoded to fit.
 * maxShortSide is the shorter dimension (1080 = "1080p", portrait or landscape).
 */
const PROFILES = {
	rpi4: {
		maxShortSide: 1080,
		maxFps: 30,
		bitrate: "5M",
		encoder: "h264_v4l2m2m",
		fallbackEncoder: "libx264",
		threads: 2,
		extraCodecs: []
	},
	rpi5: {
		maxShortSide: 1080,
		maxFps: 60,
		bitrate: "8M",
		encoder: "libx264",
		fallbackEncoder: null,
		threads: 3,
		extraCodecs: []
	},
	generic: {
		maxShortSide: 2160,
		maxFps: 60,
		bitrate: "10M",
		encoder: "libx264",
		fallbackEncoder: null,
		threads: 0,
		extraCodecs: ["vp9", "av1"]
	}
};

/**
 * Map a device-tree model string to a profile name.
 * @param {string|null} model e.g. "Raspberry Pi 4 Model B Rev 1.4"
 * @returns {string} profile name
 */
function deviceFromModel (model) {
	if (!model) return "generic";
	if ((/Raspberry Pi 5|Raspberry Pi Compute Module 5|Raspberry Pi 500/i).test(model)) return "rpi5";
	if ((/Raspberry Pi 4|Raspberry Pi Compute Module 4|Raspberry Pi 400/i).test(model)) return "rpi4";
	// Older/smaller Pis are weaker than a Pi 4, so the Pi 4 limits are the safer choice.
	if ((/Raspberry Pi/i).test(model)) return "rpi4";
	return "generic";
}

/**
 * Read the board model on Linux; null elsewhere.
 * @returns {string|null} model string
 */
function readModel () {
	try {
		return fs.readFileSync("/proc/device-tree/model", "utf8").replace(/\0/g, "").trim();
	} catch {
		return null;
	}
}

/**
 * Resolve the profile to use from config.
 * @param {string} device "auto" | "rpi4" | "rpi5" | "generic"
 * @param {object} overrides config.videoProfile
 * @param {Function} modelReader injectable for tests
 * @returns {{device: string, model: string|null, profile: object}} resolved profile
 */
function resolveProfile (device = "auto", overrides = {}, modelReader = readModel) {
	let model = null;
	let name = device;
	if (device === "auto" || !PROFILES[device]) {
		model = modelReader();
		name = deviceFromModel(model);
	}
	return {
		device: name,
		model,
		profile: { ...PROFILES[name], ...overrides }
	};
}

module.exports = { PROFILES, deviceFromModel, readModel, resolveProfile };
