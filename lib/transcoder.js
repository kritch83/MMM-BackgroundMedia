const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const CACHE_FILE = /^([0-9a-f]{40})\.mp4(\.part)?$/;

/**
 * Cache key for a source file under a profile; changes when the file or the limits change.
 * @param {{path: string, size: number, mtime: number}} file source file
 * @param {object} profile device profile
 * @returns {string} sha1 hex
 */
function cacheKey (file, profile) {
	const parts = [file.path, file.size, Math.round(file.mtime), profile.maxShortSide, profile.maxFps, profile.bitrate];
	return crypto.createHash("sha1").update(JSON.stringify(parts)).digest("hex");
}

/**
 * Display size scaled so the short side fits maxShortSide, rounded to even numbers.
 * @param {{width: number, height: number}} info probe summary (rotation already applied)
 * @param {number} maxShortSide limit
 * @returns {{width: number, height: number}} target size
 */
function targetSize (info, maxShortSide) {
	let { width, height } = info;
	const shortSide = Math.min(width, height);
	if (shortSide > maxShortSide) {
		const factor = maxShortSide / shortSide;
		width *= factor;
		height *= factor;
	}
	const even = (n) => Math.max(2, Math.round(n / 2) * 2);
	return { width: even(width), height: even(height) };
}

/**
 * "5M" → "10M"
 * @param {string} rate ffmpeg bitrate
 * @returns {string} doubled bitrate
 */
function doubleRate (rate) {
	const match = (/^(\d+(?:\.\d+)?)([kKmM]?)$/).exec(String(rate));
	if (!match) return rate;
	return `${Number(match[1]) * 2}${match[2]}`;
}

/**
 * Build ffmpeg arguments for a silent, Chromium-friendly H.264 MP4.
 * @param {object} opts options
 * @param {string} opts.input source path
 * @param {string} opts.output destination path
 * @param {object} opts.info probe summary
 * @param {object} opts.profile device profile
 * @param {string} opts.encoder ffmpeg encoder name
 * @returns {string[]} ffmpeg args
 */
function buildArgs ({ input, output, info, profile, encoder }) {
	const filters = [];
	if (info.interlaced) filters.push("yadif");
	if (info.width && info.height) {
		const { width, height } = targetSize(info, profile.maxShortSide);
		filters.push(`scale=${width}:${height}`, "setsar=1");
	} else {
		const max = profile.maxShortSide;
		filters.push(`scale='if(gte(iw,ih),-2,min(iw,${max}))':'if(gte(iw,ih),min(ih,${max}),-2)'`);
	}
	if (info.fps > profile.maxFps + 0.5) filters.push(`fps=${profile.maxFps}`);
	filters.push("format=yuv420p");

	const args = ["-hide_banner", "-nostdin", "-y", "-i", input, "-map", "0:v:0", "-an", "-sn", "-dn", "-vf", filters.join(",")];
	if (encoder === "libx264") {
		args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-maxrate", profile.bitrate, "-bufsize", doubleRate(profile.bitrate), "-profile:v", "high");
	} else {
		args.push("-c:v", encoder, "-b:v", profile.bitrate);
	}
	if (profile.threads) args.push("-threads", String(profile.threads));
	args.push("-movflags", "+faststart", "-f", "mp4", output);
	return args;
}

/**
 * Serial ffmpeg queue writing into a cache directory.
 */
class Transcoder {
	constructor ({ ffmpegPath, cacheDir, profile, log }) {
		this.ffmpegPath = ffmpegPath;
		this.cacheDir = cacheDir;
		this.profile = profile;
		this.log = log;
		this.queue = [];
		this.jobs = new Map();
		this.current = null;
		this.useNice = true;
		this.primaryFailures = 0;
		this.primaryDisabled = false;
		this.stopped = false;
		fs.mkdirSync(cacheDir, { recursive: true });
	}

	outputPath (key) {
		return path.join(this.cacheDir, `${key}.mp4`);
	}

	isCached (key) {
		return fs.existsSync(this.outputPath(key));
	}

	get pending () {
		return this.jobs.size;
	}

	/**
	 * Queue a transcode; resolves with the output path. Duplicate keys share one job.
	 * @param {string} key cache key
	 * @param {string} input source path
	 * @param {object} info probe summary
	 * @returns {Promise<string>} output path
	 */
	enqueue (key, input, info) {
		if (this.jobs.has(key)) return this.jobs.get(key).promise;
		const job = { key, input, info };
		job.promise = new Promise((resolve, reject) => {
			job.resolve = resolve;
			job.reject = reject;
		});
		this.jobs.set(key, job);
		this.queue.push(job);
		this.drain();
		return job.promise;
	}

	async drain () {
		if (this.current) return;
		while (this.queue.length && !this.stopped) {
			const job = this.queue.shift();
			this.current = job;
			try {
				job.resolve(await this.run(job));
			} catch (error) {
				job.reject(error);
			} finally {
				this.jobs.delete(job.key);
				this.current = null;
			}
		}
	}

	async run (job) {
		const { encoder, fallbackEncoder } = this.profile;
		const encoders = this.primaryDisabled ? [fallbackEncoder] : [encoder, fallbackEncoder].filter(Boolean);
		const output = this.outputPath(job.key);
		const part = `${output}.part`;
		let lastError;
		for (const enc of encoders) {
			const started = Date.now();
			this.log.info(`transcoding (${enc}, ${this.queue.length} more queued): ${job.input}`);
			try {
				await this.ffmpeg(buildArgs({ input: job.input, output: part, info: job.info, profile: this.profile, encoder: enc }), job);
				fs.renameSync(part, output);
				if (enc === encoder) this.primaryFailures = 0;
				this.log.info(`transcoded in ${Math.round((Date.now() - started) / 1000)}s: ${job.input}`);
				return output;
			} catch (error) {
				lastError = error;
				fs.rmSync(part, { force: true });
				if (this.stopped) break;
				if (enc === encoder && fallbackEncoder) {
					this.log.warn(`${enc} failed, retrying with ${fallbackEncoder}: ${error.message}`);
					if (++this.primaryFailures >= 2) {
						this.primaryDisabled = true;
						this.log.warn(`${enc} failed twice in a row; using ${fallbackEncoder} for the rest of this session`);
					}
				}
			}
		}
		throw lastError;
	}

	ffmpeg (args, job) {
		return new Promise((resolve, reject) => {
			const [cmd, cmdArgs] = this.useNice ? ["nice", ["-n", "15", this.ffmpegPath, ...args]] : [this.ffmpegPath, args];
			const child = spawn(cmd, cmdArgs, { stdio: ["ignore", "ignore", "pipe"] });
			job.child = child;
			let stderr = "";
			let settled = false;
			child.stderr.on("data", (chunk) => {
				stderr = (stderr + chunk).slice(-2000);
			});
			child.on("error", (error) => {
				if (settled) return;
				settled = true;
				if (error.code === "ENOENT" && this.useNice) {
					// No `nice` on this system; run ffmpeg directly.
					this.useNice = false;
					this.ffmpeg(args, job).then(resolve, reject);
				} else {
					reject(error);
				}
			});
			child.on("close", (code, signal) => {
				if (settled) return;
				settled = true;
				job.child = null;
				if (code === 0) return resolve();
				const lines = stderr.trim().split("\n").slice(-3).join(" | ");
				reject(new Error(`ffmpeg exited ${code ?? signal}: ${lines}`));
			});
		});
	}

	/**
	 * Delete cached outputs that no longer belong to any source file, plus stale partial files.
	 * @param {Set<string>} keepKeys keys still in use
	 */
	cleanup (keepKeys) {
		let names;
		try {
			names = fs.readdirSync(this.cacheDir);
		} catch {
			return;
		}
		for (const name of names) {
			const match = CACHE_FILE.exec(name);
			if (!match || this.jobs.has(match[1])) continue;
			if (match[2] || !keepKeys.has(match[1])) {
				fs.rmSync(path.join(this.cacheDir, name), { force: true });
			}
		}
	}

	stop () {
		this.stopped = true;
		for (const job of this.queue) job.reject(new Error("stopped"));
		this.queue = [];
		if (this.current && this.current.child) this.current.child.kill("SIGTERM");
	}
}

module.exports = { Transcoder, cacheKey, targetSize, buildArgs, doubleRate };
