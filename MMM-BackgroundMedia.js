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
		shortVideoLength: 10 * 1000, // ms; videos shorter than this count as "short" below
		videoSlowdown: "short", // "off" | "short" | "all": ease to a stop at the end
		slowdownDuration: 1000, // ms the slow-down takes on screen
		videoFreeze: "short", // "off" | "short" | "all": then hold the last frame...
		freezeDuration: 3 * 1000, // ...for this long (ms) before moving on
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
		showConversionStatus: true,
		conversionStatusLocation: "bottomLeft", // bottomRight | bottomLeft | topRight | topLeft
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
				toggleInfo: ["ArrowDown", "i"],
				folderMenu: ["Menu"],
				clearVideoCache: ["c"], // re-convert the current video (press twice)
				clearAllCache: ["C"] // Shift+C: delete every converted video (press twice)
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
		// Actions you mapped yourself keep their keys even if MMM-Carousel uses them too.
		this.userMappedActions = new Set(Object.keys(userKb.map || {}));
		this.config.keyBindings = { ...kb, ...userKb, map: { ...kb.map, ...userKb.map }, menuMap: { ...kb.menuMap, ...userKb.menuMap } };
		// Older configs used shortVideoDelay for the freeze length.
		if (user.freezeDuration === undefined && user.shortVideoDelay !== undefined) this.config.freezeDuration = user.shortVideoDelay;

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
		this.convert = el("div", `bgm-convert bgm-convert-${this.config.conversionStatusLocation}`, root);
		const convertHead = el("div", "bgm-convert-head", this.convert);
		el("i", "fa-solid fa-spinner fa-spin", convertHead);
		this.convertTitle = el("span", "", convertHead);
		this.convertPercent = el("span", "bgm-convert-percent", convertHead);
		this.convertName = el("div", "bgm-convert-name", this.convert);
		this.convertBar = el("div", "bgm-convert-bar", el("div", "bgm-convert-track", this.convert));

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
		this.updateConversion();
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
		} else if (notification === "BGM_CONVERSION") {
			this.conversion = payload;
			this.updateConversion();
		} else if (notification === "BGM_SELECTION") {
			this.selection = payload.selection || [];
			this.applyFilter();
			this.updateEmpty();
		}
	},

	notificationReceived (notification, payload) {
		if (notification === "KEYPRESS") {
			this.handleKey(payload);
		} else if (notification === "BACKGROUNDMEDIA_CLEAR_VIDEO_CACHE") {
			// From another module: deliberate, so no press-twice confirmation.
			this.clearCache(false);
		} else if (notification === "BACKGROUNDMEDIA_CLEAR_ALL_CACHE") {
			this.clearCache(true);
		} else if (notification === "CAROUSEL_CHANGED") {
			// Sent before Carousel hides every module for the page change.
			this.onNextCarouselSlide = this.isOnCarouselSlide(payload && payload.slide);
		} else if (notification === "BACKGROUNDMEDIA_SELECT_FOLDERS") {
			this.selectFolders(payload);
		} else if (BGM_NOTIFICATION_ACTIONS[notification]) {
			this.doAction(BGM_NOTIFICATION_ACTIONS[notification]);
		}
	},

	// MMM-Carousel hides every module between pages; stay up (and playing) when the next page shows us too.
	hide (speed, callback, options = {}) {
		if (options && options.lockString === "mmmc" && this.onNextCarouselSlide) {
			if (typeof callback === "function") callback();
			return;
		}
		Module.prototype.hide.call(this, speed, callback, options);
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
		if (!action) return;
		// Keys MMM-Carousel uses are its, unless you mapped that action here yourself.
		if (this.carouselKeys().has(kp.keyName) && !this.userMappedActions.has(action)) return;
		this.doAction(action);
	},

	carousel () {
		return MM.getModules().withClass("MMM-Carousel")[0] || null;
	},

	// Keys MMM-Carousel reacts to, read from its config (never changed), worked out once.
	carouselKeys () {
		if (this.carouselKeySet) return this.carouselKeySet;
		const keys = new Set();
		const carousel = this.carousel();
		// Carousel ignores keys in positional mode.
		if (carousel && carousel.config.mode !== "positional") {
			const ckb = carousel.config.keyBindings || {};
			if (ckb.enabled !== false && (ckb.mode || "DEFAULT") === this.config.keyBindings.mode) {
				const map = { NextSlide: "ArrowRight", PrevSlide: "ArrowLeft", Pause: "ArrowDown", Slide0: "Home", ...ckb.map };
				for (const key of Object.values(map)) [].concat(key).forEach((k) => keys.add(k));
			}
			if (carousel.config.enableKeyboardControl) ["ArrowRight", "ArrowLeft", "ArrowDown", "Home", ..."0123456789"].forEach((k) => keys.add(k));
			if (keys.size) Log.info(`[${this.name}] MMM-Carousel handles ${[...keys].join(", ")}; leaving those keys to it`);
		}
		this.carouselKeySet = keys;
		return keys;
	},

	// Is this module listed on Carousel slide number `index` (slides mode, same key order Carousel uses)?
	isOnCarouselSlide (index) {
		const carousel = this.carousel();
		if (!carousel || carousel.config.mode !== "slides" || !carousel.config.slides) return false;
		const slide = Object.values(carousel.config.slides)[index];
		return Array.isArray(slide) && slide.some((m) => (typeof m === "string" ? m : m && m.name) === this.name);
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
			case "clearVideoCache":
				if (!this.current || !this.current.converted) {
					this.indicate("fa-circle-info", "This item isn't a converted video");
				} else {
					this.confirmTwice(action, "Press again to re-convert this video", () => this.clearCache(false));
				}
				break;
			case "clearAllCache":
				this.confirmTwice(action, "Press again to delete all converted videos", () => this.clearCache(true));
				break;
		}
	},

	// Destructive keys need a second press within 3 s; the first only shows the prompt.
	confirmTwice (action, prompt, run) {
		const armed = this.armedAction === action && performance.now() - this.armedAt < 3000;
		this.armedAction = armed ? null : action;
		this.armedAt = performance.now();
		if (armed) run();
		else this.indicate("fa-triangle-exclamation", prompt);
	},

	clearCache (all) {
		const current = this.current;
		if (!all && (!current || !current.converted)) return;
		this.sendSocketNotification("BGM_CLEAR_CACHE", all ? {} : { id: current.id });
		this.indicate("fa-trash-can", all ? "Converted videos deleted; converting again" : "Converting this video again");
		// Its file is being deleted, so move on rather than wait for playback to fail.
		if (current && current.converted) this.advance("next");
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
			layer.video.playbackRate = 1;
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
		await this.display(item);
	},

	// Named display(), not show(): show()/hide() are MagicMirror's own "make this module visible" methods,
	// which other modules (MMM-Carousel, MMM-Pir, Remote-Control) call.
	async display (item) {
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
		const cfg = this.config;
		const maxSeconds = cfg.maxVideoDuration > 0 ? cfg.maxVideoDuration / 1000 : Infinity;
		const total = () => Math.min(Number.isFinite(video.duration) ? video.duration : 0, maxSeconds);
		const appliesTo = (mode) => mode === "all" || (mode === "short" && total() > 0 && total() * 1000 < cfg.shortVideoLength);
		// Slow-down length D in on-screen seconds; braking evenly to zero uses the last D/2 seconds of footage.
		const slowSeconds = () => (cfg.slowdownDuration > 0 && appliesTo(cfg.videoSlowdown) ? Math.min(cfg.slowdownDuration / 1000, 2 * total()) : 0);
		const holdSeconds = () => (appliesTo(cfg.videoFreeze) ? Math.max(0, cfg.freezeDuration) / 1000 : 0);
		// A slow-down brakes to the start of the last frame (measured from frame timestamps), not past it.
		let frameSeconds = null;
		let lastMediaTime = null;
		const end = () => total() - (slowSeconds() ? frameSeconds || 1 / 30 : 0);
		// On-screen seconds for the whole video, and how many are left from the current position.
		const screenTime = () => {
			const D = slowSeconds();
			const remaining = Math.max(0, end() - video.currentTime);
			return { full: end() + D / 2, left: remaining > D / 2 ? remaining + D / 2 : Math.sqrt(2 * remaining * D) };
		};
		// Speed from footage left (not a timer), so pause and replay need no special handling.
		// Braking evenly, the frame from s1 to s2 seconds-left must take sqrt(2D)·(√s1 − √s2) on screen,
		// so its speed is (√s1 + √s2) / √(2D); summed over the frames that lasts exactly D.
		const updateRate = () => {
			const D = slowSeconds();
			const s1 = Math.max(0, end() - video.currentTime);
			const s2 = Math.max(0, s1 - (frameSeconds || 1 / 30));
			const rate = !D || s1 >= D / 2 ? 1 : Math.min(1, Math.max(0.0625, (Math.sqrt(s1) + Math.sqrt(s2)) / Math.sqrt(2 * D)));
			if (Math.abs(video.playbackRate - rate) > 0.005) video.playbackRate = rate;
		};
		layer.finished = false;
		layer.holding = false;
		const finish = (allowHold = true) => {
			if (layer.finished || token !== this.showToken) return;
			layer.finished = true;
			const hold = allowHold ? holdSeconds() : 0;
			if (hold <= 0) {
				this.advance("next");
				return;
			}
			// Rest on the last frame; the hold pauses and resumes like a photo timer.
			layer.holding = true;
			video.pause();
			const whole = screenTime().full + hold;
			if (this.timerAnim) this.timerAnim.cancel();
			this.timerAnim = this.bar.animate([{ transform: `scaleX(${screenTime().full / whole})` }, { transform: "scaleX(1)" }], { duration: hold * 1000, fill: "forwards" });
			this.timerAnim.onfinish = () => {
				if (token === this.showToken) this.advance("next");
			};
			this.applyPlayState();
		};
		// The bar spans video + freeze: this part runs to where the freeze takes over.
		const syncBar = () => {
			if (layer.holding || !total()) return;
			const { full: screen, left } = screenTime();
			const whole = screen + holdSeconds();
			if (this.timerAnim) this.timerAnim.cancel();
			this.timerAnim = this.bar.animate(
				[{ transform: `scaleX(${Math.min(1, (screen - left) / whole)})` }, { transform: `scaleX(${screen / whole})` }],
				{ duration: Math.max(0, left * 1000), fill: "forwards" }
			);
			if (video.paused) this.timerAnim.pause();
		};
		const freezeBar = () => {
			if (this.timerAnim && !layer.holding) this.timerAnim.pause();
		};
		// Recompute the speed on every frame, but only from ~1 s before the slow zone (cheap on a Pi);
		// timeupdate (4×/s) starts it, and it restarts after a replay.
		let looping = false;
		const onFrame = (now, frame) => {
			if (signal.aborted || token !== this.showToken) {
				looping = false;
				return;
			}
			const t = frame.mediaTime;
			if (lastMediaTime !== null && t > lastMediaTime && video.playbackRate > 0.99) {
				frameSeconds = Math.max(1 / 120, Math.min(frameSeconds || Infinity, t - lastMediaTime));
			}
			lastMediaTime = t;
			// Replayed from the start: stop until timeupdate brings us near the end again.
			if (end() - t > slowSeconds() / 2 + 1.5) {
				looping = false;
				return;
			}
			// The last frame is on screen: the video has come to rest.
			if (t >= end() - 0.002) {
				looping = false;
				finish();
				return;
			}
			updateRate();
			video.requestVideoFrameCallback(onFrame);
		};
		const startSlowdown = () => {
			if (looping || !slowSeconds() || end() - video.currentTime > slowSeconds() / 2 + 1) return;
			looping = true;
			if (typeof video.requestVideoFrameCallback === "function") {
				lastMediaTime = null;
				video.requestVideoFrameCallback(onFrame);
			} else {
				video.addEventListener("timeupdate", updateRate, { signal });
			}
		};
		startSlowdown();
		video.addEventListener("timeupdate", startSlowdown, { signal });
		video.addEventListener("playing", syncBar, { signal });
		video.addEventListener("seeked", syncBar, { signal });
		video.addEventListener("pause", freezeBar, { signal });
		video.addEventListener("waiting", freezeBar, { signal });
		video.addEventListener("ended", () => finish(), { signal });
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
		if (layer.video) {
			layer.video.playbackRate = 1;
			layer.video.style.display = "none";
		}
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

	updateConversion () {
		if (!this.convert) return;
		const status = this.conversion;
		this.convert.classList.toggle("bgm-show", Boolean(status) && this.config.showConversionStatus);
		if (!status) return;
		const percent = Number.isFinite(status.percent) ? Math.round(status.percent) : null;
		this.convertTitle.textContent = `Converting ${status.index} of ${status.total}`;
		this.convertPercent.textContent = percent === null ? "" : `${percent}%`;
		this.convertName.textContent = status.name;
		// Ease forward, but snap back to 0 when the next file starts.
		this.convertBar.style.transition = (percent ?? 0) < (this.lastConvertPercent ?? 0) ? "none" : "";
		this.convertBar.style.transform = `scaleX(${(percent ?? 0) / 100})`;
		this.lastConvertPercent = percent;
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
