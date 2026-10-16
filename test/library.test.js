const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { scan, parseExtensions, expandPath } = require("../lib/scanner");
const { buildFolders } = require("../lib/folders");
const { Transcoder, buildArgs, targetSize, doubleRate, cacheKey, progressPercent } = require("../lib/transcoder");
const { PROFILES } = require("../lib/profiles");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bgm-test-"));
const touch = (root, rel) => {
	const file = path.join(root, rel);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, "x");
	return file;
};

test("scanner filters extensions, skips excluded and hidden folders, respects recursive", () => {
	const root = tmp();
	["a.jpg", "b.PNG", "c.mov", "notes.txt", "Trip/d.mpeg", "Trip/Day 2/e.jpeg", "@eaDir/thumb.jpg", ".hidden/f.jpg"].forEach((f) => touch(root, f));
	const opts = { mediaPaths: [root], excludePaths: ["@eaDir"], extensions: "jpg,jpeg,png,mov,mpeg" };

	const all = scan({ ...opts, recursive: true }).map((f) => path.relative(root, f.path)).sort();
	assert.deepEqual(all, ["Trip/Day 2/e.jpeg", "Trip/d.mpeg", "a.jpg", "b.PNG", "c.mov"]);

	const flat = scan({ ...opts, recursive: false }).map((f) => path.basename(f.path)).sort();
	assert.deepEqual(flat, ["a.jpg", "b.PNG", "c.mov"]);

	const types = Object.fromEntries(scan({ ...opts, recursive: true }).map((f) => [path.basename(f.path), f.type]));
	assert.equal(types["c.mov"], "video");
	assert.equal(types["d.mpeg"], "video");
	assert.equal(types["b.PNG"], "image");
});

test("scanner reports missing paths instead of throwing", () => {
	const errors = [];
	const files = scan({ mediaPaths: ["/definitely/not/here"], extensions: "jpg", onError: (p) => errors.push(p) });
	assert.deepEqual(files, []);
	assert.equal(errors.length, 1);
});

test("parseExtensions and expandPath", () => {
	assert.deepEqual([...parseExtensions(" .JPG, png ,")], ["jpg", "png"]);
	assert.equal(expandPath("~/Pictures", "/mm"), path.join(os.homedir(), "Pictures"));
	assert.equal(expandPath("media", "/mm"), "/mm/media");
});

test("folders: single root lists subfolders to the given depth", () => {
	const root = "/m";
	const files = ["/m/top.jpg", "/m/Family/a.jpg", "/m/Trip 10/b.jpg", "/m/Trip 2/c.jpg", "/m/Trip 2/Day 1/d.jpg"].map((p) => ({ path: p }));
	const { folders, fileDirs } = buildFolders([root], files, 2);
	assert.deepEqual(folders.map((f) => [f.label, f.depth, f.count]), [
		["Family", 0, 1],
		["Trip 2", 0, 2],
		["Trip 2 / Day 1", 1, 1],
		["Trip 10", 0, 1]
	]);
	assert.deepEqual(fileDirs.get("/m/top.jpg"), []);
	const day1 = fileDirs.get("/m/Trip 2/Day 1/d.jpg").map((i) => folders[i].label);
	assert.deepEqual(day1, ["Trip 2", "Trip 2 / Day 1"]);

	const shallow = buildFolders([root], files, 1).folders.map((f) => f.label);
	assert.deepEqual(shallow, ["Family", "Trip 2", "Trip 10"]);
});

test("folders: several roots are folders themselves", () => {
	const files = ["/photos/x.jpg", "/photos/Pets/y.jpg", "/videos/z.mov"].map((p) => ({ path: p }));
	const { folders, fileDirs } = buildFolders(["/photos", "/videos"], files, 1);
	assert.deepEqual(folders.map((f) => [f.label, f.depth, f.count]), [
		["photos", 0, 2],
		["photos / Pets", 1, 1],
		["videos", 0, 1]
	]);
	assert.deepEqual(fileDirs.get("/photos/Pets/y.jpg").map((i) => folders[i].id), ["/photos", "/photos/Pets"]);
});

test("targetSize keeps aspect, fits the short side, rounds to even", () => {
	assert.deepEqual(targetSize({ width: 3840, height: 2160 }, 1080), { width: 1920, height: 1080 });
	assert.deepEqual(targetSize({ width: 2160, height: 3840 }, 1080), { width: 1080, height: 1920 });
	assert.deepEqual(targetSize({ width: 853, height: 480 }, 1080), { width: 854, height: 480 });
});

test("buildArgs for libx264 and the Pi hardware encoder", () => {
	const info = { width: 853, height: 480, fps: 59.94, interlaced: true };
	const x264 = buildArgs({ input: "in.mpg", output: "out.part", info, profile: PROFILES.rpi4, encoder: "libx264" });
	assert.ok(x264.includes("-an"));
	assert.equal(x264[x264.indexOf("-progress") + 1], "pipe:1");
	assert.equal(x264[x264.indexOf("-vf") + 1], "yadif,scale=854:480,setsar=1,fps=30,format=yuv420p");
	assert.equal(x264[x264.indexOf("-bufsize") + 1], "10M");
	assert.deepEqual(x264.slice(-3), ["-f", "mp4", "out.part"]);
	const hw = buildArgs({ input: "in.mov", output: "o", info: { width: 1920, height: 1080, fps: 30 }, profile: PROFILES.rpi4, encoder: "h264_v4l2m2m" });
	assert.equal(hw[hw.indexOf("-c:v") + 1], "h264_v4l2m2m");
	assert.equal(hw[hw.indexOf("-b:v") + 1], "5M");
	assert.ok(!hw.includes("-crf"));
	assert.equal(doubleRate("2.5M"), "5M");
});

test("cacheKey follows the output, so a Pi 4 cache carries over to a Pi 5", () => {
	const file = { path: "/a.mov", size: 10, mtime: 1 };
	const hevc30 = { width: 3840, height: 2160, fps: 30 };
	const a = cacheKey(file, hevc30, PROFILES.rpi4);
	assert.match(a, /^[0-9a-f]{40}$/);
	assert.notEqual(a, cacheKey({ ...file, mtime: 2 }, hevc30, PROFILES.rpi4), "file changed");
	assert.equal(a, cacheKey(file, hevc30, PROFILES.rpi5), "same 1080p30 output on both Pis");
	assert.equal(a, cacheKey(file, hevc30, { ...PROFILES.rpi4, encoder: "libx264", bitrate: "4M" }), "encoder/bitrate don't matter");
	const sixty = { width: 1920, height: 1080, fps: 60 };
	assert.notEqual(cacheKey(file, sixty, PROFILES.rpi4), cacheKey(file, sixty, PROFILES.rpi5), "Pi 5 keeps 60 fps, Pi 4 halves it");
	assert.notEqual(a, cacheKey(file, hevc30, PROFILES.generic), "generic keeps 4K");
});

test("transcoder cleanup removes orphans and partial files only", () => {
	const dir = tmp();
	const log = { info () {}, warn () {}, error () {} };
	const t = new Transcoder({ ffmpegPath: "ffmpeg", cacheDir: dir, profile: PROFILES.rpi4, log });
	const keep = "a".repeat(40);
	const orphan = "b".repeat(40);
	for (const name of [`${keep}.mp4`, `${keep}.mp4.part`, `${orphan}.mp4`, "state.json"]) fs.writeFileSync(path.join(dir, name), "");
	t.cleanup(new Set([keep]));
	assert.deepEqual(fs.readdirSync(dir).sort(), [`${keep}.mp4`, "state.json"]);
});

test("progressPercent reads the latest out_time", () => {
	assert.equal(progressPercent("frame=10\nout_time_us=2500000\nprogress=continue\nout_time_us=5000000", 10), 50);
	assert.equal(progressPercent("out_time_us=N/A\nprogress=continue", 10), null);
	assert.equal(progressPercent("out_time_us=99000000", 10), 100);
	assert.equal(progressPercent("out_time_us=1000000", 0), null);
});

test("transcoder reports file, position in batch, percent, then null", async () => {
	const dir = tmp();
	// Stand-in for ffmpeg: prints progress, then writes the output (last argument).
	const fake = path.join(dir, "fake-ffmpeg.sh");
	fs.writeFileSync(fake, "#!/bin/sh\nfor last; do :; done\nprintf 'out_time_us=N/A\\nprogress=continue\\n'\nsleep 0.05\nprintf 'out_time_us=2000000\\nprogress=end\\n'\n: > \"$last\"\n");
	fs.chmodSync(fake, 0o755);
	const statuses = [];
	const log = { info () {}, warn () {}, error () {} };
	const profile = { ...PROFILES.rpi5 };
	const t = new Transcoder({ ffmpegPath: fake, cacheDir: path.join(dir, "cache"), profile, log, onStatus: (s) => statuses.push(s) });
	const info = { width: 1920, height: 1080, fps: 30, duration: 4 };
	await Promise.all([t.enqueue("a".repeat(40), "/m/one.mov", info), t.enqueue("b".repeat(40), "/m/two.mpeg", info)]);

	assert.equal(statuses.at(-1), null, "hidden when the queue is empty");
	const one = statuses.filter((s) => s && s.name === "one.mov");
	const two = statuses.filter((s) => s && s.name === "two.mpeg");
	assert.deepEqual(one.map((s) => s.percent), [0, 50]);
	assert.deepEqual(two.map((s) => [s.index, s.total, s.percent]), [[2, 2, 0], [2, 2, 50]]);
	assert.ok(fs.existsSync(t.outputPath("b".repeat(40))));
});

test("transcoder remove / clearAll delete converted videos but not ones converting now", () => {
	const dir = tmp();
	const log = { info () {}, warn () {}, error () {} };
	const t = new Transcoder({ ffmpegPath: "ffmpeg", cacheDir: dir, profile: PROFILES.rpi4, log });
	const [a, b, busy] = ["a", "b", "c"].map((ch) => ch.repeat(40));
	for (const name of [`${a}.mp4`, `${b}.mp4`, `${busy}.mp4.part`, "state.json"]) fs.writeFileSync(path.join(dir, name), "");
	t.jobs.set(busy, {});
	t.remove(a);
	assert.deepEqual(fs.readdirSync(dir).sort(), [`${b}.mp4`, `${busy}.mp4.part`, "state.json"]);
	t.clearAll();
	assert.deepEqual(fs.readdirSync(dir).sort(), [`${busy}.mp4.part`, "state.json"], "in-progress file and folder selection survive");
});
