const { execFile } = require("node:child_process");

/**
 * Run ffprobe and return its parsed JSON.
 * @param {string} ffprobePath binary
 * @param {string} file media file
 * @returns {Promise<object>} ffprobe output
 */
function probe (ffprobePath, file) {
	return new Promise((resolve, reject) => {
		execFile(
			ffprobePath,
			["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file],
			{ maxBuffer: 10 * 1024 * 1024, timeout: 60000 },
			(error, stdout) => {
				if (error) return reject(error);
				try {
					resolve(JSON.parse(stdout));
				} catch (parseError) {
					reject(parseError);
				}
			}
		);
	});
}

/**
 * Resolve once whether ffprobe/ffmpeg can be executed.
 * @param {string} binary path
 * @returns {Promise<boolean>} true when the binary runs
 */
function isAvailable (binary) {
	return new Promise((resolve) => {
		execFile(binary, ["-version"], { timeout: 15000 }, (error) => resolve(!error));
	});
}

/**
 * @param {object} data ffprobe output
 * @returns {object|undefined} the main video stream (cover art excluded)
 */
function videoStream (data) {
	return (data.streams || []).find((s) => s.codec_type === "video" && !(s.disposition && s.disposition.attached_pic));
}

/**
 * "30000/1001" → 29.97
 * @param {string} rate ffprobe rational
 * @returns {number} frames per second, 0 if unknown
 */
function parseRate (rate) {
	if (!rate) return 0;
	const [num, den] = String(rate).split("/").map(Number);
	if (!den) return num || 0;
	return num / den;
}

/**
 * Rotation in degrees from either side data (newer ffmpeg) or the legacy rotate tag.
 * @param {object} stream ffprobe stream
 * @returns {number} rotation
 */
function rotation (stream) {
	const side = (stream.side_data_list || []).find((d) => typeof d.rotation === "number");
	if (side) return side.rotation;
	return Number(stream.tags && stream.tags.rotate) || 0;
}

/**
 * Summarise what matters for the playability decision.
 * @param {object} data ffprobe output
 * @returns {object|null} summary, null when there is no video stream
 */
function summarize (data) {
	const stream = videoStream(data);
	if (!stream) return null;
	const avg = parseRate(stream.avg_frame_rate);
	const fps = avg > 0 ? avg : parseRate(stream.r_frame_rate);
	let width = stream.width || 0;
	let height = stream.height || 0;
	// Anamorphic sources (DV, some MPEG-2) store a non-square sample aspect ratio.
	const [sarNum, sarDen] = String(stream.sample_aspect_ratio || "1:1").split(":").map(Number);
	if (sarNum > 0 && sarDen > 0 && sarNum !== sarDen) width = Math.round(width * sarNum / sarDen);
	if (Math.abs(rotation(stream)) % 180 === 90) [width, height] = [height, width];
	const format = (data.format && data.format.format_name) || "";
	const tags = { ...(stream.tags || {}), ...((data.format && data.format.tags) || {}) };
	return {
		container: format,
		codec: stream.codec_name,
		pixFmt: stream.pix_fmt,
		width,
		height,
		anamorphic: sarNum > 0 && sarDen > 0 && sarNum !== sarDen,
		fps,
		interlaced: ["tt", "bb", "tb", "bt"].includes(stream.field_order),
		duration: Number(data.format && data.format.duration) || Number(stream.duration) || 0,
		creationTime: tags.creation_time || null
	};
}

const MP4_LIKE = /(^|,)(mov|mp4)(,|$)/;
const WEBM = /(^|,)webm(,|$)/;
const PLAIN_420 = new Set(["yuv420p", "yuvj420p"]);

/**
 * Decide whether Chromium on this device can play a video as-is.
 * @param {object|null} info summarize() result
 * @param {object} profile device profile
 * @returns {{action: "native"|"transcode"|"skip", reason: string}} decision
 */
function decide (info, profile) {
	if (!info) return { action: "skip", reason: "no video stream" };

	const extraCodecs = profile.extraCodecs || [];
	const mp4Like = MP4_LIKE.test(info.container);
	const webm = WEBM.test(info.container);
	let codecOk = false;
	if (info.codec === "h264") codecOk = mp4Like && PLAIN_420.has(info.pixFmt);
	else if (info.codec === "vp8") codecOk = webm;
	else if (extraCodecs.includes(info.codec)) codecOk = (mp4Like || webm) && PLAIN_420.has(info.pixFmt);

	if (!codecOk) return { action: "transcode", reason: `${info.codec}/${info.pixFmt} in ${info.container}` };
	if (info.interlaced) return { action: "transcode", reason: "interlaced" };
	const shortSide = Math.min(info.width, info.height);
	if (shortSide > profile.maxShortSide) return { action: "transcode", reason: `${info.width}x${info.height} exceeds ${profile.maxShortSide}p` };
	if (info.fps > profile.maxFps + 0.5) return { action: "transcode", reason: `${info.fps.toFixed(1)} fps exceeds ${profile.maxFps}` };
	return { action: "native", reason: "playable" };
}

module.exports = { probe, isAvailable, summarize, decide, parseRate };
