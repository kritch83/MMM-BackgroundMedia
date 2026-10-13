/*
 * Play order, no-repeat cycles and back/forward history for MMM-BackgroundMedia.
 * Loaded in the browser via getScripts() and required directly by the tests.
 */
(function (root, factory) {
	if (typeof module === "object" && module.exports) module.exports = factory();
	else root.BackgroundMediaPlaylist = factory();
}(typeof self !== "undefined" ? self : this, function () {
	class Playlist {
		constructor ({ order = "shuffle", sortDescending = false, historySize = 100, random = Math.random } = {}) {
			this.order = order;
			this.sortDescending = sortDescending;
			this.historySize = historySize;
			this.random = random;
			this.items = new Map();
			this.filter = null;
			this.queue = [];
			this.shown = new Set();
			this.history = [];
			this.pos = -1;
		}

		playable (id) {
			const item = this.items.get(id);
			return Boolean(item) && (!this.filter || this.filter(item));
		}

		get size () {
			let n = 0;
			for (const id of this.items.keys()) if (this.playable(id)) n++;
			return n;
		}

		/**
		 * Replace the item list (rescan, finished transcode) without restarting the cycle.
		 * @param {object[]} items items with at least {id, sortName, date}
		 */
		setItems (items) {
			const known = this.items;
			this.items = new Map(items.map((item) => [item.id, item]));
			if (this.order === "shuffle") {
				this.queue = this.queue.filter((id) => this.items.has(id));
				const queued = new Set(this.queue);
				for (const id of this.items.keys()) {
					if (known.has(id) || queued.has(id) || this.shown.has(id)) continue;
					this.queue.splice(Math.floor(this.random() * (this.queue.length + 1)), 0, id);
				}
			} else {
				this.queue = this.sorted([...this.items.keys()].filter((id) => !this.shown.has(id)));
			}

			let removedBefore = 0;
			this.history = this.history.filter((id, i) => {
				const keep = this.items.has(id);
				if (!keep && i < this.pos) removedBefore++;
				return keep;
			});
			this.pos = Math.min(this.pos - removedBefore, this.history.length - 1);
		}

		/**
		 * Limit playback to items matching fn (null = everything).
		 * @param {Function|null} fn predicate
		 * @param {boolean} restart start a fresh cycle (the selection changed)
		 */
		setFilter (fn, restart = true) {
			this.filter = fn || null;
			if (restart) {
				this.pos = this.history.length - 1;
				this.startCycle();
			}
		}

		startCycle () {
			this.shown.clear();
			const ids = [...this.items.keys()].filter((id) => this.playable(id));
			this.queue = this.order === "shuffle" ? this.shuffle(ids) : this.sorted(ids);
			// Don't open a new shuffle with the item that just played.
			const current = this.history[this.pos];
			if (this.order === "shuffle" && this.queue.length > 1 && this.queue[0] === current) this.queue.push(this.queue.shift());
		}

		take () {
			while (this.queue.length) {
				const id = this.queue.shift();
				if (this.playable(id)) return id;
			}
			return null;
		}

		/**
		 * @returns {object|null} the next item (forward through history first)
		 */
		next () {
			for (let p = this.pos + 1; p < this.history.length; p++) {
				if (this.playable(this.history[p])) {
					this.pos = p;
					return this.items.get(this.history[p]);
				}
			}
			let id = this.take();
			if (id === null) {
				this.startCycle();
				id = this.take();
			}
			if (id === null) return null;
			this.shown.add(id);
			this.history.push(id);
			if (this.history.length > this.historySize) this.history.shift();
			this.pos = this.history.length - 1;
			return this.items.get(id);
		}

		/**
		 * @returns {object|null} the previously shown item, or null at the start of history
		 */
		previous () {
			for (let p = this.pos - 1; p >= 0; p--) {
				if (this.playable(this.history[p])) {
					this.pos = p;
					return this.items.get(this.history[p]);
				}
			}
			return null;
		}

		shuffle (ids) {
			const a = ids.slice();
			for (let i = a.length - 1; i > 0; i--) {
				const j = Math.floor(this.random() * (i + 1));
				[a[i], a[j]] = [a[j], a[i]];
			}
			return a;
		}

		sorted (ids) {
			const items = ids.map((id) => this.items.get(id));
			if (this.order === "date") {
				items.sort((a, b) => (a.date ?? a.mtime ?? 0) - (b.date ?? b.mtime ?? 0));
			} else {
				items.sort((a, b) => String(a.sortName ?? a.name).localeCompare(String(b.sortName ?? b.name), undefined, { numeric: true, sensitivity: "base" }));
			}
			if (this.sortDescending) items.reverse();
			return items.map((item) => item.id);
		}
	}

	return Playlist;
}));
