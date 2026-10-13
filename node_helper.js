const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const NodeHelper = require("node_helper");
const Log = require("logger");
const { scan, expandPath } = require("./lib/scanner");
const { resolveProfile } = require("./lib/profiles");
const { probe, isAvailable, summarize, decide } = require("./lib/probe");
const { Transcoder, cacheKey } = require("./lib/transcoder");
const { imageDate, videoDate } = require("./lib/metadata");
const { buildFolders } = require("./lib/folders");

// MagicMirror's logger prefixes each line with the calling module's folder name.
const log = {
	info: (...args) => Log.info(...args),
	warn: (...args) => Log.warn(...args),
	error: (...args) => Log.error(...args)
};

// Without ffprobe these are tried as-is; files the browser can't play get dropped.
const NATIVE_WITHOUT_FFPROBE = new Set([".mp4", ".m4v", ".mov"]);
// Chromium is happier with H.264 .mov files when they're labelled as MP4.
const MIME_OVERRIDES = { ".mov": "video/mp4", ".m4v": "video/mp4" };

/**
 * Run fn over items with at most `limit` in flight.
 * @param {Array} items work items
 * @param {number} limit concurrency
 * @param {Function} fn async worker
 */
async function eachLimit (items, limit, fn) {
	let next = 0;
	const worker = async () => {
		while (next < items.length) await fn(items[next++]);
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

const sha1 = (value) => crypto.createHash("sha1").update(value).digest("hex");

module.exports = NodeHelper.create({
	start () {
		this.configKey = null;
		this.entries = new Map();
		this.folders = [];
		this.selection = [];
		this.transcoder = null;
		this.expressApp.get(`/${this.name}/media/:id`, (req, res) => this.serve(req, res));
	},

	stop () {
		clearInterval(this.rescanTimer);
		if (this.transcoder) this.transcoder.stop();
	},

	socketNotificationReceived (notification, payload) {
		switch (notification) {
			case "BGM_CONFIG":
				this.configure(payload);
				break;
			case "BGM_RESCAN":
				if (this.config) this.rescan();
				break;
			case "BGM_PLAYBACK_ERROR":
				this.playbackError(payload && payload.id);
				break;
			case "BGM_SELECT_FOLDERS":
				this.select(payload && payload.ids);
				break;
		}
	},

	async configure (config) {
		const key = JSON.stringify(config);
		if (key === this.configKey) {
			// Another browser (or a page reload) with the same config: just catch it up.
			this.sendItems();
			return;
		}
		if (this.configKey) {
			log.warn("received a different config; restarting the media library");
			this.stop();
		}
		this.configKey = key;
		this.config = config;
		this.baseDir = global.root_path || process.cwd();
		this.entries = new Map();

		const { device, model, profile } = resolveProfile(config.device, config.videoProfile);
		this.profile = profile;
		log.info(`device profile "${device}"${model ? ` (${model})` : ""}: videos up to ${profile.maxShortSide}p ${profile.maxFps}fps play as-is`);

		this.cacheDir = config.cacheDir ? expandPath(config.cacheDir, this.baseDir) : path.join(this.path, "cache");
		this.ffprobeOk = await isAvailable(config.ffprobePath);
		const ffmpegOk = config.transcode && await isAvailable(config.ffmpegPath);
		if (!this.ffprobeOk) {
			log.error(`ffprobe not found at "${config.ffprobePath}". Install ffmpeg (sudo apt install ffmpeg). Until then only mp4/m4v/mov videos are tried as-is.`);
		}
		if (config.transcode && !ffmpegOk) {
			log.error(`ffmpeg not found at "${config.ffmpegPath}"; videos the browser can't play will be skipped.`);
		}
		this.transcoder = null;
		if (ffmpegOk && this.ffprobeOk) {
			try {
				this.transcoder = new Transcoder({ ffmpegPath: config.ffmpegPath, cacheDir: this.cacheDir, profile, log });
			} catch (error) {
				log.error(`cannot use cache folder ${this.cacheDir} (${error.message}); videos that need converting will be skipped`);
			}
		}

		this.loadState();
		await this.rescan();
		if (config.rescanInterval > 0) this.rescanTimer = setInterval(() => this.rescan(), config.rescanInterval);
	},

	rescan () {
		if (this.scanning) {
			this.rescanQueued = true;
			return this.scanning;
		}
		this.scanning = this.scanLibrary()
			.catch((error) => log.error(`scan failed: ${error.stack || error}`))
			.finally(() => {
				this.scanning = null;
				if (this.rescanQueued) {
					this.rescanQueued = false;
					this.rescan();
				}
			});
		return this.scanning;
	},

	async scanLibrary () {
		const config = this.config;
		const started = Date.now();
		const roots = config.mediaPaths.map((p) => expandPath(p, this.baseDir));
		const files = scan({
			mediaPaths: roots,
			recursive: config.recursive,
			excludePaths: config.excludePaths,
			extensions: config.extensions,
			baseDir: this.baseDir,
			onError: (p, error) => log.warn(`cannot read ${p}: ${error.message}`)
		});
		const { folders, fileDirs } = buildFolders(roots, files, config.folderDepth);

		const entries = new Map();
		const fresh = [];
		for (const file of files) {
			const id = sha1(file.path).slice(0, 20);
			const old = this.entries.get(id);
			const entry = old && old.size === file.size && old.mtime === file.mtime ? old : { id, ...file, name: path.basename(file.path), status: "new" };
			const root = roots.find((r) => file.path.startsWith(r + path.sep));
			entry.sortName = root ? path.relative(root, file.path) : entry.name;
			entry.dirs = fileDirs.get(file.path) || [];
			entries.set(id, entry);
			if (entry.status === "new") fresh.push(entry);
		}
		this.entries = entries;
		this.folders = folders;
		this.scheduleSend();

		// Photos first so the slideshow can start before every video is probed.
		const images = fresh.filter((e) => e.type === "image");
		const videos = fresh.filter((e) => e.type === "video");
		await eachLimit(images, 8, (e) => this.processImage(e).then(() => this.scheduleSend()));
		await eachLimit(videos, 2, (e) => this.processVideo(e).then(() => this.scheduleSend()));

		if (this.transcoder) {
			const keep = new Set([...entries.values()].map((e) => e.cacheKey).filter(Boolean));
			this.transcoder.cleanup(keep);
		}
		const count = (pred) => [...entries.values()].filter(pred).length;
		log.info(`scan done in ${((Date.now() - started) / 1000).toFixed(1)}s: ${count((e) => e.type === "image" && e.status === "ready")} photos, `
			+ `${count((e) => e.type === "video" && e.status === "ready")} videos ready, ${count((e) => e.status === "pending")} waiting for transcoding, `
			+ `${count((e) => e.status === "skip" || e.status === "error")} skipped, ${folders.length} folders`);
		this.scheduleSend();
	},

	async processImage (entry) {
		entry.date = (await imageDate(entry.path)) ?? entry.mtime;
		this.markReady(entry, entry.path);
	},

	async processVideo (entry) {
		entry.date = entry.mtime;
		if (!this.ffprobeOk) {
			if (NATIVE_WITHOUT_FFPROBE.has(path.extname(entry.path).toLowerCase())) this.markReady(entry, entry.path);
			else entry.status = "skip";
			return;
		}
		try {
			entry.info = summarize(await probe(this.config.ffprobePath, entry.path));
		} catch (error) {
			log.warn(`cannot probe ${entry.path}: ${error.message}`);
			entry.status = "error";
			return;
		}
		entry.date = videoDate(entry.info) ?? entry.mtime;
		const decision = decide(entry.info, this.profile);
		if (decision.action === "skip") {
			log.warn(`skipping ${entry.path}: ${decision.reason}`);
			entry.status = "skip";
		} else if (decision.action === "native") {
			// A cached copy means the browser failed on the original before (see playbackError).
			const key = this.transcoder && cacheKey(entry, this.profile);
			if (key && this.transcoder.isCached(key)) {
				entry.cacheKey = key;
				this.markReady(entry, this.transcoder.outputPath(key));
			} else {
				this.markReady(entry, entry.path);
			}
		} else {
			this.transcode(entry, decision.reason);
		}
	},

	transcode (entry, reason) {
		if (!this.transcoder) {
			log.warn(`cannot play ${entry.path} (${reason}) and ffmpeg is unavailable; skipping`);
			entry.status = "skip";
			return;
		}
		const key = cacheKey(entry, this.profile);
		entry.cacheKey = key;
		if (this.transcoder.isCached(key)) {
			this.markReady(entry, this.transcoder.outputPath(key));
			return;
		}
		entry.status = "pending";
		log.info(`queued for transcoding (${reason}): ${entry.path}`);
		this.transcoder.enqueue(key, entry.path, entry.info).then(
			(output) => {
				if (this.entries.get(entry.id) !== entry) return;
				this.markReady(entry, output);
				this.scheduleSend();
			},
			(error) => {
				if (error.message !== "stopped") log.error(`transcoding failed for ${entry.path}: ${error.message}`);
				entry.status = "error";
			}
		);
	},

	markReady (entry, servePath) {
		entry.servePath = servePath;
		entry.status = "ready";
		entry.version = `${Math.round(entry.mtime).toString(36)}${entry.cacheKey ? `-${entry.cacheKey.slice(0, 6)}` : ""}`;
	},

	playbackError (id) {
		const entry = this.entries.get(id);
		if (!entry || entry.status !== "ready") return;
		if (entry.type === "video" && !entry.cacheKey && entry.info && this.transcoder) {
			log.warn(`browser could not play ${entry.path}; transcoding it`);
			this.transcode(entry, "browser playback failed");
		} else {
			log.warn(`browser could not display ${entry.path}; skipping it`);
			entry.status = "error";
		}
		this.scheduleSend();
	},

	// Leading-edge throttle: first update goes out at once, then at most every 2 s.
	scheduleSend () {
		if (this.sendTimer) {
			this.sendDirty = true;
			return;
		}
		this.sendItems();
		this.sendTimer = setTimeout(() => {
			this.sendTimer = null;
			if (this.sendDirty) {
				this.sendDirty = false;
				this.scheduleSend();
			}
		}, 2000);
	},

	sendItems () {
		const items = [];
		for (const e of this.entries.values()) {
			if (e.status !== "ready") continue;
			items.push({
				id: e.id,
				url: `${this.name}/media/${e.id}?v=${e.version}`,
				type: e.type,
				name: e.name,
				sortName: e.sortName,
				date: e.date,
				mtime: e.mtime,
				dirs: e.dirs
			});
		}
		this.sendSocketNotification("BGM_ITEMS", {
			items,
			folders: this.folders,
			selection: this.selection,
			pending: this.transcoder ? this.transcoder.pending : 0
		});
	},

	serve (req, res) {
		const entry = this.entries.get(req.params.id);
		if (!entry || entry.status !== "ready") {
			res.sendStatus(404);
			return;
		}
		const type = MIME_OVERRIDES[path.extname(entry.servePath).toLowerCase()];
		if (type) res.type(type);
		res.sendFile(entry.servePath, { dotfiles: "allow", maxAge: "1d" }, (error) => {
			// Aborted range requests are normal while video seeks/preloads.
			if (error && !res.headersSent) res.sendStatus(error.status || 500);
		});
	},

	select (ids) {
		this.selection = Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [];
		this.saveState();
		this.sendSocketNotification("BGM_SELECTION", { selection: this.selection });
	},

	statePath () {
		return path.join(this.cacheDir, "state.json");
	},

	loadState () {
		this.selection = [];
		if (this.config.rememberFolderSelection === false) return;
		try {
			const state = JSON.parse(fs.readFileSync(this.statePath(), "utf8"));
			if (Array.isArray(state.selection)) this.selection = state.selection;
		} catch {
			// No saved state yet.
		}
	},

	saveState () {
		if (!this.config || this.config.rememberFolderSelection === false) return;
		try {
			fs.mkdirSync(this.cacheDir, { recursive: true });
			fs.writeFileSync(this.statePath(), JSON.stringify({ selection: this.selection }, null, 2));
		} catch (error) {
			log.warn(`could not save folder selection: ${error.message}`);
		}
	}
});
