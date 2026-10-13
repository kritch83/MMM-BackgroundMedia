/* global BackgroundMediaPlaylist */

/*
 * MMM-BackgroundMedia
 * Full-screen background slideshow of photos and videos for MagicMirror².
 * MIT Licensed.
 */

const BGM_NOTIFICATION_ACTIONS = {
	BACKGROUNDMEDIA_NEXT: "next",
	BACKGROUNDMEDIA_PREVIOUS: "previous",
	BACKGROUNDMEDIA_PAUSE: "pause",
	BACKGROUNDMEDIA_PLAY: "play",
	BACKGROUNDMEDIA_PLAYPAUSE: "playPause",
	BACKGROUNDMEDIA_REPLAY: "replay",
	BACKGROUNDMEDIA_TOGGLE_INFO: "toggleInfo",
	BACKGROUNDMEDIA_FOLDER_MENU: "folderMenu",
	BACKGROUNDMEDIA_RESCAN: "rescan"
};

const BGM_LOAD_TIMEOUT = 15000;
const BGM_BACKDROP_WIDTH = 64;
const BGM_BACKDROP_DIM = 0.3;

Module.register("MMM-BackgroundMedia", {
	requiresVersion: "2.25.0",

	defaults: {
		// Library
		mediaPaths: ["modules/MMM-BackgroundMedia/media"],
		recursive: true,
		excludePaths: ["@eaDir", "#recycle", "#snapshot"],
		extensions: "jpg,jpeg,png,mov,mp4,m4v,mpg,mpeg",
		rescanInterval: 30 * 60 * 1000,
		folderDepth: 1,
		rememberFolderSelection: true,

		// Playback
		order: "shuffle", // "shuffle" | "name" | "date"
		sortDescending: false,
		imageDuration: 15 * 1000,
		maxVideoDuration: 0, // ms; 0 = play whole video
		shortVideoLength: 10 * 1000, // videos shorter than this (ms)...
		shortVideoDelay: 3 * 1000, // ...hold their last frame this long before moving on; 0 = off
		transitionDuration: 1500, // crossfade ms; 0 = hard cut
		fit: "contain-blur", // "contain-blur" | "contain" | "cover"
		position: "center",

		// Overlays
		showInfo: false,
		infoLocation: "bottomRight", // bottomRight | bottomLeft | topRight | topLeft
		infoFields: ["name", "date"], // name | date | folder
		dateFormat: { dateStyle: "long" }, // Intl.DateTimeFormat options
		showProgressBar: true,
		showIndicator: true,
		showGradient: true,
		gradientDirection: "vertical", // vertical | horizontal | both | radial
		gradient: ["rgba(0, 0, 0, 0.75) 0%", "rgba(0, 0, 0, 0) 40%", "rgba(0, 0, 0, 0) 80%", "rgba(0, 0, 0, 0.75) 100%"],
		horizontalGradient: ["rgba(0, 0, 0, 0.75) 0%", "rgba(0, 0, 0, 0) 40%", "rgba(0, 0, 0, 0) 80%", "rgba(0, 0, 0, 0.75) 100%"],
		radialGradient: ["rgba(0, 0, 0, 0) 0%", "rgba(0, 0, 0, 0) 75%", "rgba(0, 0, 0, 0.25) 100%"],
		menuTimeout: 30 * 1000,

		// Video / device
		device: "auto", // "auto" | "rpi4" | "rpi5" | "generic"
		videoProfile: {}, // override profile values, e.g. { maxFps: 25 }
		transcode: true,
		cacheDir: null, // default: <module>/cache
		ffmpegPath: "ffmpeg",
		ffprobePath: "ffprobe",

		// MMM-KeyBindings
		keyBindings: {
			enabled: true,
			mode: "DEFAULT",
			menuMode: "BACKGROUNDMEDIA_MENU",
			map: {
				next: ["ArrowRight", "MediaNextTrack"],
				previous: ["ArrowLeft", "MediaPreviousTrack"],
				playPause: ["Enter", "MediaPlayPause"],
				replay: ["ArrowUp"],
				toggleInfo: ["ArrowDown"],
				folderMenu: ["Menu"]
			},
			menuMap: {
				up: ["ArrowUp"],
				down: ["ArrowDown"],
				select: ["Enter", "MediaPlayPause"],
				close: ["Return", "Menu"] // MMM-KeyBindings maps Escape/Backspace to "Return"
			}
		}
	},

	getScripts () {
		return [this.file("playlist.js")];
	},

	getStyles () {
		return ["font-awesome.css", this.file("MMM-BackgroundMedia.css")];
	},

	start () {
		// Nested objects are merged so users can override a single key binding.
		const user = this.data.config || {};
		const kb = this.defaults.keyBindings;
		const userKb = user.keyBindings || {};
		this.config.keyBindings = { ...kb, ...userKb, map: { ...kb.map, ...userKb.map }, menuMap: { ...kb.menuMap, ...userKb.menuMap } };

		this.playlist = new BackgroundMediaPlaylist({ order: this.config.order, sortDescending: this.config.sortDescending });
		this.layers = [];
		this.active = null;
		this.current = null;
		this.showToken = 0;
		this.failures = 0;
		this.userPaused = false;
		this.suspended = false;
		this.infoVisible = Boolean(this.config.showInfo);
		this.folders = [];
		this.selection = [];
		this.filterKey = null;
		this.totalItems = 0;
		this.pending = 0;
		this.menuOpen = false;

		this.sendSocketNotification("BGM_CONFIG", this.config);
	},

	/* ---------- DOM ---------- */

	getDom () {
		if (this.root) return this.root;
		const el = (tag, className, parent) => {
			const node = document.createElement(tag);
			if (className) node.className = className;
			if (parent) parent.appendChild(node);
			return node;
		};

		const root = el("div", `bgm bgm-fit-${this.config.fit}`);
		root.style.setProperty("--bgm-position", this.config.position);
		root.style.setProperty("--bgm-transition", `${this.config.transitionDuration}ms`);

		for (let i = 0; i < 2; i++) {
			const layer = { el: el("div", "bgm-layer", root) };
			layer.backdrop = el("canvas", "bgm-backdrop", layer.el);
			layer.stage = el("div", "bgm-stage", layer.el);
			this.layers.push(layer);
		}

		if (this.config.showGradient) el("div", "bgm-gradient", root).style.background = this.gradientCss();

		this.info = el("div", `bgm-info bgm-info-${this.config.infoLocation}`, root);
		this.progress = el("div", `bgm-progress${this.config.showProgressBar ? "" : " bgm-progress-hidden"}`, root);
		this.bar = el("div", "bgm-progress-bar", this.progress);
		this.pausedBadge = el("div", "bgm-paused-badge", root);
		el("i", "fa-solid fa-pause", this.pausedBadge);
		this.empty = el("div", "bgm-empty", root);

		// The indicator and folder menu go above every other region, not behind them.
		this.overlay = el("div", "bgm-overlay", document.body);
		this.indicator = el("div", "bgm-indicator", this.overlay);
		this.indicatorIcon = el("i", "", this.indicator);
		this.indicatorText = el("div", "bgm-indicator-text", this.indicator);
		this.menu = el("div", "bgm-menu", this.overlay);
		el("div", "bgm-menu-title", this.menu).textContent = "Choose folders";
		this.menuList = el("div", "bgm-menu-list", this.menu);
		el("div", "bgm-menu-hint", this.menu).textContent = "▲ ▼ move  ·  OK select  ·  Back / Menu done";

		this.root = root;
		this.updateEmpty();
		if (!this.current && this.playlist.size) setTimeout(() => this.advance("next"), 0);
		return root;
	},

	gradientCss () {
		const c = this.config;
		const linear = (dir, stops) => `linear-gradient(${dir}, ${stops.join(", ")})`;
		switch (c.gradientDirection) {
			case "horizontal":
				return linear("to right", c.horizontalGradient);
			case "both":
				return `${linear("to bottom", c.gradient)}, ${linear("to right", c.horizontalGradient)}`;
			case "radial":
				return `radial-gradient(circle, ${c.radialGradient.join(", ")})`;
			default:
				return linear("to bottom", c.gradient);
		}
	},

	/* ---------- Messages ---------- */

	socketNotificationReceived (notification, payload) {
		if (notification === "BGM_ITEMS") {
			this.folders = payload.folders || [];
			this.selection = payload.selection || [];
			this.totalItems = payload.items.length;
			this.pending = payload.pending || 0;
			this.playlist.setItems(payload.items);
			this.applyFilter();
			this.updateEmpty();
			if (this.root && !this.current && !this.loading && this.playlist.size) this.advance("next");
		} else if (notification === "BGM_SELECTION") {
			this.selection = payload.selection || [];
			this.applyFilter();
			this.updateEmpty();
		}
	},

	notificationReceived (notification, payload) {
		if (notification === "KEYPRESS") {
			this.handleKey(payload);
		} else if (notification === "BACKGROUNDMEDIA_SELECT_FOLDERS") {
			this.selectFolders(payload);
		} else if (BGM_NOTIFICATION_ACTIONS[notification]) {
			this.doAction(BGM_NOTIFICATION_ACTIONS[notification]);
		}
	},

	suspend () {
		this.suspended = true;
		this.applyPlayState();
	},

	resume () {
		this.suspended = false;
		this.applyPlayState();
	},

	/* ---------- Keys & actions ---------- */

	handleKey (kp) {
		const kb = this.config.keyBindings;
		if (!kb.enabled || !kp || !kp.keyName) return;
		if (kp.keyState && kp.keyState !== "KEY_PRESSED") return;
		const lookup = (map) => Object.keys(map).find((action) => [].concat(map[action]).includes(kp.keyName));

		if (this.menuOpen) {
			if (kp.currentMode && kp.currentMode !== kb.menuMode) return;
			const action = lookup(kb.menuMap);
			if (action) this.menuAction(action);
			return;
		}
		if (kp.currentMode && kp.currentMode !== kb.mode) return;
		const action = lookup(kb.map);
		if (action) this.doAction(action);
	},

	doAction (action) {
		switch (action) {
			case "next":
				this.indicate("fa-forward-step");
				this.advance("next");
				break;
			case "previous":
				this.indicate("fa-backward-step");
				this.advance("previous");
				break;
			case "playPause":
				this.setPaused(!this.userPaused);
				break;
			case "pause":
				this.setPaused(true);
				break;
			case "play":
				this.setPaused(false);
				break;
			case "replay":
				this.replay();
				break;
			case "toggleInfo":
				this.infoVisible = !this.infoVisible;
				this.updateInfo();
				this.indicate("fa-circle-info");
				break;
			case "folderMenu":
				if (this.menuOpen) this.closeMenu();
				else this.openMenu();
				break;
			case "rescan":
				this.sendSocketNotification("BGM_RESCAN");
				this.indicate("fa-arrows-rotate");
				break;
		}
	},

	setPaused (paused) {
		this.userPaused = paused;
		this.applyPlayState();
		this.indicate(paused ? "fa-pause" : "fa-play");
	},

	replay () {
		const layer = this.active;
		if (!layer || !layer.item) return;
		this.userPaused = false;
		if (layer.item.type === "video") {
			// Also cancels a short-video hold; "seeked" rebuilds the progress bar.
			layer.holding = false;
			layer.finished = false;
			if (this.timerAnim) this.timerAnim.cancel();
			this.timerAnim = null;
			layer.video.currentTime = 0;
		} else if (this.timerAnim) {
			this.timerAnim.currentTime = 0;
		}
		this.applyPlayState();
		this.indicate("fa-rotate-left");
	},

	applyPlayState () {
		const running = !this.userPaused && !this.suspended;
		if (this.pausedBadge) this.pausedBadge.classList.toggle("bgm-show", this.userPaused);
		const layer = this.active;
		if (!layer || !layer.item) return;
		if (layer.item.type === "video" && !layer.holding) {
			if (running) layer.video.play().catch(() => {});
			else layer.video.pause();
		} else if (this.timerAnim) {
			if (!running) this.timerAnim.pause();
			else if (this.timerAnim.playState === "paused") this.timerAnim.play();
		}
	},

	indicate (icon, text) {
		if (!this.indicator || (!this.config.showIndicator && !text)) return;
		this.indicatorIcon.className = `fa-solid ${icon}`;
		this.indicatorText.textContent = text || "";
		if (this.indicatorAnim) this.indicatorAnim.cancel();
		this.indicatorAnim = this.indicator.animate(
			[{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }],
			{ duration: text ? 2600 : 1200, easing: "ease-out" }
		);
	},

	/* ---------- Playback engine ---------- */

	async advance (direction) {
		if (!this.root) return;
		const item = direction === "previous" ? this.playlist.previous() : this.playlist.next();
		if (!item) return;
		clearTimeout(this.retryTimer);
		// Freeze the current timer so it can't fire while the next item loads.
		if (this.timerAnim) this.timerAnim.pause();
		await this.show(item);
	},

	async show (item) {
		const token = ++this.showToken;
		const incoming = this.layers.find((layer) => layer !== this.active);
		this.resetLayer(incoming);
		this.loading = true;
		try {
			await this.load(incoming, item);
		} catch (error) {
			if (token !== this.showToken) return;
			this.loading = false;
			Log.warn(`[${this.name}] could not load ${item.name}: ${error.message}`);
			this.resetLayer(incoming);
			this.sendSocketNotification("BGM_PLAYBACK_ERROR", { id: item.id });
			this.failures++;
			const delay = this.failures >= Math.max(3, this.playlist.size) ? 60 * 1000 : 0;
			this.retryTimer = setTimeout(() => this.advance("next"), delay);
			return;
		}
		// A newer show() took over this layer while we were loading.
		if (token !== this.showToken) return;
		this.loading = false;
		this.failures = 0;

		const outgoing = this.active;
		if (outgoing) this.stopLayer(outgoing);
		if (this.timerAnim) this.timerAnim.cancel();
		this.timerAnim = null;

		incoming.el.classList.add("bgm-visible");
		if (outgoing) {
			outgoing.el.classList.remove("bgm-visible");
			outgoing.cleanupTimer = setTimeout(() => this.resetLayer(outgoing), this.config.transitionDuration + 100);
		}
		this.active = incoming;
		this.current = item;
		this.startItem(incoming, item, token);
		this.updateInfo();
	},

	load (layer, item) {
		const controller = new AbortController();
		layer.abort = controller;
		layer.item = item;
		const { signal } = controller;

		const guard = (promise) => new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("timed out")), BGM_LOAD_TIMEOUT);
			signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
			promise.then(resolve, reject).finally(() => clearTimeout(timer));
		});

		if (item.type === "image") {
			const img = document.createElement("img");
			img.className = "bgm-media";
			img.decoding = "async";
			img.src = item.url;
			return guard(img.decode().catch(() => {
				throw new Error("image could not be decoded");
			})).then(() => {
				layer.img = img;
				layer.stage.appendChild(img);
				this.drawBackdrop(layer, img, img.naturalWidth, img.naturalHeight);
			});
		}

		if (!layer.video) {
			const video = document.createElement("video");
			video.className = "bgm-media";
			video.muted = true;
			video.defaultMuted = true;
			video.playsInline = true;
			video.preload = "auto";
			video.disablePictureInPicture = true;
			layer.stage.appendChild(video);
			layer.video = video;
		}
		const video = layer.video;
		video.style.display = "";
		const ready = new Promise((resolve, reject) => {
			video.addEventListener("loadeddata", resolve, { once: true, signal });
			video.addEventListener("error", () => reject(new Error(video.error ? video.error.message || `media error ${video.error.code}` : "media error")), { once: true, signal });
		});
		video.src = item.url;
		video.load();
		return guard(ready).then(() => this.drawBackdrop(layer, video, video.videoWidth, video.videoHeight));
	},

	startItem (layer, item, token) {
		const { signal } = layer.abort;
		if (item.type === "image") {
			this.timerAnim = this.bar.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: this.config.imageDuration, fill: "forwards" });
			this.timerAnim.onfinish = () => {
				if (token === this.showToken) this.advance("next");
			};
			this.applyPlayState();
			return;
		}

		const video = layer.video;
		const maxSeconds = this.config.maxVideoDuration > 0 ? this.config.maxVideoDuration / 1000 : Infinity;
		const total = () => Math.min(Number.isFinite(video.duration) ? video.duration : 0, maxSeconds);
		layer.finished = false;
		layer.holding = false;
		const finish = (allowHold = true) => {
			if (layer.finished || token !== this.showToken) return;
			layer.finished = true;
			const length = total();
			const hold = allowHold && length > 0 && length * 1000 < this.config.shortVideoLength ? this.config.shortVideoDelay : 0;
			if (hold <= 0) {
				this.advance("next");
				return;
			}
			// Short clips rest on their last frame; the hold pauses and resumes like a photo timer.
			layer.holding = true;
			video.pause();
			if (this.timerAnim) this.timerAnim.cancel();
			this.timerAnim = this.bar.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(1)" }], { duration: hold, fill: "forwards" });
			this.timerAnim.onfinish = () => {
				if (token === this.showToken) this.advance("next");
			};
			this.applyPlayState();
		};
		const syncBar = () => {
			if (layer.holding) return;
			const length = total();
			if (!length) return;
			if (this.timerAnim) this.timerAnim.cancel();
			const from = Math.min(1, video.currentTime / length);
			this.timerAnim = this.bar.animate([{ transform: `scaleX(${from})` }, { transform: "scaleX(1)" }], { duration: Math.max(0, (length - video.currentTime) * 1000), fill: "forwards" });
			if (video.paused) this.timerAnim.pause();
		};
		const freezeBar = () => {
			if (this.timerAnim && !layer.holding) this.timerAnim.pause();
		};
		video.addEventListener("playing", syncBar, { signal });
		video.addEventListener("seeked", syncBar, { signal });
		video.addEventListener("pause", freezeBar, { signal });
		video.addEventListener("waiting", freezeBar, { signal });
		video.addEventListener("ended", finish, { signal });
		if (Number.isFinite(maxSeconds)) {
			video.addEventListener("timeupdate", () => {
				if (video.currentTime >= maxSeconds) finish();
			}, { signal });
		}
		video.addEventListener("error", () => {
			if (token !== this.showToken) return;
			Log.warn(`[${this.name}] playback failed for ${item.name}`);
			this.sendSocketNotification("BGM_PLAYBACK_ERROR", { id: item.id });
			finish(false);
		}, { signal });

		if (this.config.fit === "contain-blur") {
			layer.backdropTimer = setInterval(() => this.drawBackdrop(layer, video, video.videoWidth, video.videoHeight), 500);
		}
		syncBar();
		this.applyPlayState();
	},

	// Stop an outgoing layer's playback and listeners; it stays visible while it fades out.
	stopLayer (layer) {
		if (layer.abort) layer.abort.abort();
		layer.abort = null;
		clearInterval(layer.backdropTimer);
		if (layer.video) layer.video.pause();
	},

	resetLayer (layer) {
		clearTimeout(layer.cleanupTimer);
		this.stopLayer(layer);
		layer.el.classList.remove("bgm-visible");
		if (layer.img) {
			layer.img.remove();
			layer.img = null;
		}
		if (layer.video && layer.video.hasAttribute("src")) {
			// Release the decoder; important on a Pi.
			layer.video.removeAttribute("src");
			layer.video.load();
		}
		if (layer.video) layer.video.style.display = "none";
		layer.item = null;
		layer.holding = false;
		const ctx = layer.backdrop.getContext("2d");
		ctx.clearRect(0, 0, layer.backdrop.width, layer.backdrop.height);
	},

	// Blurred fill behind "contain" media, drawn into a tiny canvas that CSS stretches to full screen.
	drawBackdrop (layer, source, sw, sh) {
		if (this.config.fit !== "contain-blur" || !sw || !sh) return;
		const canvas = layer.backdrop;
		const width = BGM_BACKDROP_WIDTH;
		const height = Math.max(1, Math.round(width * window.innerHeight / window.innerWidth));
		if (canvas.width !== width) canvas.width = width;
		if (canvas.height !== height) canvas.height = height;
		const ctx = canvas.getContext("2d");
		const scale = Math.max(width / sw, height / sh) * 1.1;
		const dw = sw * scale;
		const dh = sh * scale;
		ctx.filter = "blur(2px)";
		ctx.drawImage(source, (width - dw) / 2, (height - dh) / 2, dw, dh);
		ctx.filter = "none";
		ctx.fillStyle = `rgba(0, 0, 0, ${BGM_BACKDROP_DIM})`;
		ctx.fillRect(0, 0, width, height);
	},

	/* ---------- Overlays ---------- */

	updateInfo () {
		if (!this.info) return;
		const item = this.current;
		this.info.textContent = "";
		if (!item || !this.infoVisible) {
			this.info.classList.remove("bgm-show");
			return;
		}
		for (const field of this.config.infoFields) {
			let text = "";
			if (field === "name") text = item.name.replace(/\.[^.]+$/, "");
			else if (field === "date" && item.date) text = this.formatDate(item.date);
			else if (field === "folder" && item.dirs && item.dirs.length) text = (this.folders[item.dirs[item.dirs.length - 1]] || {}).label || "";
			if (!text) continue;
			const line = document.createElement("div");
			line.className = `bgm-info-${field}`;
			line.textContent = text;
			this.info.appendChild(line);
		}
		this.info.classList.add("bgm-show");
	},

	formatDate (ms) {
		try {
			const language = globalThis.config && globalThis.config.language;
			return new Intl.DateTimeFormat(language || undefined, this.config.dateFormat).format(new Date(ms));
		} catch {
			return new Date(ms).toLocaleDateString();
		}
	},

	updateEmpty () {
		if (!this.empty) return;
		let text = "";
		if (!this.playlist.size) {
			if (this.totalItems) text = "Nothing to show in the selected folders";
			else if (this.pending) text = `Preparing ${this.pending} video${this.pending === 1 ? "" : "s"}…`;
			else text = "No photos or videos found";
		}
		this.empty.textContent = text;
		this.empty.classList.toggle("bgm-show", Boolean(text) && !this.current);
	},

	/* ---------- Folder selection ---------- */

	applyFilter () {
		const selected = new Set();
		for (const id of this.selection) {
			const index = this.folders.findIndex((folder) => folder.id === id);
			if (index >= 0) selected.add(index);
		}
		// Ids (not indices) identify the selection, so a rescan that adds folders doesn't restart the cycle.
		const key = [...selected].map((i) => this.folders[i].id).sort().join("\n");
		const restart = key !== this.filterKey;
		this.filterKey = key;
		this.playlist.setFilter(selected.size ? (item) => (item.dirs || []).some((d) => selected.has(d)) : null, restart);
		if (restart && this.current && !this.playlist.playable(this.current.id) && this.playlist.size) this.advance("next");
	},

	selectFolders (payload) {
		const wanted = Array.isArray(payload) ? payload : payload && payload.folders !== undefined ? payload.folders : payload;
		if (wanted === "all" || wanted === undefined || wanted === null) {
			this.sendSocketNotification("BGM_SELECT_FOLDERS", { ids: [] });
			return;
		}
		const ids = [];
		for (const name of [].concat(wanted)) {
			const needle = String(name).toLowerCase();
			const match = this.folders.find((f) => f.id === name)
				|| this.folders.find((f) => f.label.toLowerCase() === needle)
				|| this.folders.find((f) => f.label.toLowerCase().split(" / ").pop() === needle);
			if (match) ids.push(match.id);
			else Log.warn(`[${this.name}] unknown folder "${name}"`);
		}
		this.sendSocketNotification("BGM_SELECT_FOLDERS", { ids });
	},

	openMenu () {
		if (!this.folders.length) {
			this.indicate("fa-folder", "No folders to choose from");
			return;
		}
		const known = new Set(this.folders.map((f) => f.id));
		this.menuSelection = new Set(this.selection.filter((id) => known.has(id)));
		this.menuInitial = [...this.menuSelection].sort().join("\n");
		this.menuCursor = 0;
		this.menuOpen = true;
		this.menu.classList.add("bgm-show");
		this.renderMenu();
		this.sendNotification("KEYPRESS_MODE_CHANGED", this.config.keyBindings.menuMode);
		this.armMenuTimeout();
	},

	closeMenu () {
		if (!this.menuOpen) return;
		this.menuOpen = false;
		clearTimeout(this.menuTimer);
		this.menu.classList.remove("bgm-show");
		this.sendNotification("KEYPRESS_MODE_CHANGED", this.config.keyBindings.mode);

		const ids = [...this.menuSelection];
		if (ids.slice().sort().join("\n") === this.menuInitial) return;
		this.sendSocketNotification("BGM_SELECT_FOLDERS", { ids });
		const labels = this.folders.filter((f) => this.menuSelection.has(f.id)).map((f) => f.label);
		const summary = labels.length ? labels.slice(0, 3).join(", ") + (labels.length > 3 ? ` +${labels.length - 3} more` : "") : "All media";
		this.indicate("fa-folder-open", `Playing: ${summary}`);
	},

	armMenuTimeout () {
		clearTimeout(this.menuTimer);
		if (this.config.menuTimeout > 0) this.menuTimer = setTimeout(() => this.closeMenu(), this.config.menuTimeout);
	},

	menuAction (action) {
		const rowCount = this.folders.length + 1;
		if (action === "up") this.menuCursor = (this.menuCursor - 1 + rowCount) % rowCount;
		else if (action === "down") this.menuCursor = (this.menuCursor + 1) % rowCount;
		else if (action === "select") {
			if (this.menuCursor === 0) {
				this.menuSelection.clear();
			} else {
				const id = this.folders[this.menuCursor - 1].id;
				if (this.menuSelection.has(id)) this.menuSelection.delete(id);
				else this.menuSelection.add(id);
			}
		} else if (action === "close") {
			this.closeMenu();
			return;
		}
		this.renderMenu();
		this.armMenuTimeout();
	},

	renderMenu () {
		this.menuList.textContent = "";
		const rows = [{ label: "All media", count: this.totalItems, depth: 0, all: true }, ...this.folders];
		rows.forEach((row, i) => {
			const checked = row.all ? this.menuSelection.size === 0 : this.menuSelection.has(row.id);
			const node = document.createElement("div");
			node.className = `bgm-menu-row${i === this.menuCursor ? " bgm-cursor" : ""}${checked ? " bgm-checked" : ""}`;
			node.style.paddingLeft = `${0.6 + row.depth * 1.4}em`;
			const icon = document.createElement("i");
			icon.className = row.all ? `fa-${checked ? "solid" : "regular"} fa-circle${checked ? "-check" : ""}` : `fa-${checked ? "solid" : "regular"} fa-square${checked ? "-check" : ""}`;
			const label = document.createElement("span");
			label.className = "bgm-menu-label";
			label.textContent = row.all ? row.label : row.label.split(" / ").pop();
			const count = document.createElement("span");
			count.className = "bgm-menu-count";
			count.textContent = row.count;
			node.append(icon, label, count);
			this.menuList.appendChild(node);
			if (i === this.menuCursor) node.scrollIntoView({ block: "nearest" });
		});
	}
});
