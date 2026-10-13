const { test } = require("node:test");
const assert = require("node:assert/strict");
const { summarize, decide, parseRate } = require("../lib/probe");
const { PROFILES, deviceFromModel, resolveProfile } = require("../lib/profiles");

const MOV = "mov,mp4,m4a,3gp,3g2,mj2";
const fixture = (format, stream) => ({ format: { format_name: format, duration: "12.5", tags: {} }, streams: [{ codec_type: "audio", codec_name: "aac" }, { codec_type: "video", ...stream }] });

const FIXTURES = {
	iphoneHevc: fixture(MOV, { codec_name: "hevc", pix_fmt: "yuv420p10le", width: 3840, height: 2160, avg_frame_rate: "30/1", side_data_list: [{ rotation: -90 }] }),
	h264Mov4k: fixture(MOV, { codec_name: "h264", pix_fmt: "yuv420p", width: 3840, height: 2160, avg_frame_rate: "30000/1001" }),
	h264Mp41080: fixture(MOV, { codec_name: "h264", pix_fmt: "yuv420p", width: 1920, height: 1080, avg_frame_rate: "30/1" }),
	h264Mp41080p60: fixture(MOV, { codec_name: "h264", pix_fmt: "yuv420p", width: 1920, height: 1080, avg_frame_rate: "60/1" }),
	h264Portrait: fixture(MOV, { codec_name: "h264", pix_fmt: "yuv420p", width: 1920, height: 1080, avg_frame_rate: "30/1", tags: { rotate: "90" } }),
	mpeg2: fixture("mpeg", { codec_name: "mpeg2video", pix_fmt: "yuv420p", width: 720, height: 480, avg_frame_rate: "30000/1001", sample_aspect_ratio: "32:27", field_order: "tt" }),
	mpeg1: fixture("mpeg", { codec_name: "mpeg1video", pix_fmt: "yuv420p", width: 352, height: 240, avg_frame_rate: "30/1" }),
	prores: fixture(MOV, { codec_name: "prores", pix_fmt: "yuv422p10le", width: 1920, height: 1080, avg_frame_rate: "25/1" }),
	h264HighBit: fixture(MOV, { codec_name: "h264", pix_fmt: "yuv420p10le", width: 1280, height: 720, avg_frame_rate: "30/1" }),
	vp9Webm: fixture("matroska,webm", { codec_name: "vp9", pix_fmt: "yuv420p", width: 1920, height: 1080, avg_frame_rate: "30/1" }),
	slowmo: fixture(MOV, { codec_name: "h264", pix_fmt: "yuv420p", width: 1280, height: 720, avg_frame_rate: "240/1" })
};

const action = (name, device) => decide(summarize(FIXTURES[name]), PROFILES[device]).action;

test("decision table per device", () => {
	const expected = {
		//               rpi4         rpi5         generic
		iphoneHevc: ["transcode", "transcode", "transcode"],
		h264Mov4k: ["transcode", "transcode", "native"],
		h264Mp41080: ["native", "native", "native"],
		h264Mp41080p60: ["transcode", "native", "native"],
		h264Portrait: ["native", "native", "native"],
		mpeg2: ["transcode", "transcode", "transcode"],
		mpeg1: ["transcode", "transcode", "transcode"],
		prores: ["transcode", "transcode", "transcode"],
		h264HighBit: ["transcode", "transcode", "transcode"],
		vp9Webm: ["transcode", "transcode", "native"],
		slowmo: ["transcode", "transcode", "transcode"]
	};
	for (const [name, actions] of Object.entries(expected)) {
		["rpi4", "rpi5", "generic"].forEach((device, i) => {
			assert.equal(action(name, device), actions[i], `${name} on ${device}`);
		});
	}
});

test("no video stream is skipped", () => {
	const info = summarize({ format: { format_name: MOV }, streams: [{ codec_type: "audio" }, { codec_type: "video", disposition: { attached_pic: 1 } }] });
	assert.equal(info, null);
	assert.equal(decide(info, PROFILES.rpi4).action, "skip");
});

test("summary applies rotation and sample aspect ratio", () => {
	const hevc = summarize(FIXTURES.iphoneHevc);
	assert.deepEqual([hevc.width, hevc.height], [2160, 3840]);
	const portrait = summarize(FIXTURES.h264Portrait);
	assert.deepEqual([portrait.width, portrait.height], [1080, 1920]);
	const dv = summarize(FIXTURES.mpeg2);
	assert.deepEqual([dv.width, dv.height, dv.interlaced, dv.anamorphic], [853, 480, true, true]);
});

test("parseRate", () => {
	assert.equal(parseRate("30/1"), 30);
	assert.ok(Math.abs(parseRate("30000/1001") - 29.97) < 0.01);
	assert.equal(parseRate("0/0"), 0);
	assert.equal(parseRate(undefined), 0);
});

test("device detection from model string", () => {
	assert.equal(deviceFromModel("Raspberry Pi 5 Model B Rev 1.0"), "rpi5");
	assert.equal(deviceFromModel("Raspberry Pi 4 Model B Rev 1.4"), "rpi4");
	assert.equal(deviceFromModel("Raspberry Pi 400 Rev 1.0"), "rpi4");
	assert.equal(deviceFromModel("Raspberry Pi Compute Module 4 Rev 1.1"), "rpi4");
	assert.equal(deviceFromModel("Raspberry Pi 3 Model B Plus Rev 1.3"), "rpi4");
	assert.equal(deviceFromModel(null), "generic");
	assert.equal(deviceFromModel("Generic x86"), "generic");
});

test("resolveProfile: forced device, auto detection, overrides", () => {
	assert.equal(resolveProfile("rpi5", {}, () => "Raspberry Pi 4").device, "rpi5");
	assert.equal(resolveProfile("auto", {}, () => "Raspberry Pi 4 Model B").device, "rpi4");
	assert.equal(resolveProfile("bogus", {}, () => null).device, "generic");
	const { profile } = resolveProfile("rpi4", { maxFps: 25 });
	assert.equal(profile.maxFps, 25);
	assert.equal(profile.maxShortSide, 1080);
});
