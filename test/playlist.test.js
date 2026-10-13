const { test } = require("node:test");
const assert = require("node:assert/strict");
const Playlist = require("../playlist.js");

const make = (n, extra = () => ({})) => Array.from({ length: n }, (_, i) => ({ id: `i${i}`, name: `f${i}.jpg`, sortName: `f${i}.jpg`, date: 1000 + i, ...extra(i) }));
const drain = (p, n) => Array.from({ length: n }, () => p.next().id);

// Deterministic PRNG so shuffles are reproducible.
const seeded = (seed = 1) => () => {
	seed = (seed * 16807) % 2147483647;
	return (seed - 1) / 2147483646;
};

test("shuffle shows every item once per cycle", () => {
	const p = new Playlist({ random: seeded() });
	p.setItems(make(10));
	for (let cycle = 0; cycle < 3; cycle++) {
		const ids = drain(p, 10);
		assert.equal(new Set(ids).size, 10, `cycle ${cycle} repeated an item`);
	}
});

test("new shuffle cycle does not start with the item that just played", () => {
	for (let seed = 1; seed < 50; seed++) {
		const p = new Playlist({ random: seeded(seed) });
		p.setItems(make(3));
		const first = drain(p, 3);
		assert.notEqual(p.next().id, first[2]);
	}
});

test("name order with natural sorting, and descending", () => {
	const items = [{ id: "a", sortName: "img10.jpg" }, { id: "b", sortName: "img2.jpg" }, { id: "c", sortName: "img1.jpg" }];
	const p = new Playlist({ order: "name" });
	p.setItems(items);
	assert.deepEqual(drain(p, 3), ["c", "b", "a"]);
	const d = new Playlist({ order: "name", sortDescending: true });
	d.setItems(items);
	assert.deepEqual(drain(d, 3), ["a", "b", "c"]);
});

test("date order", () => {
	const p = new Playlist({ order: "date" });
	p.setItems([{ id: "new", date: 300 }, { id: "old", date: 100 }, { id: "mid", date: 200 }]);
	assert.deepEqual(drain(p, 3), ["old", "mid", "new"]);
});

test("previous walks back through history, next walks forward again", () => {
	const p = new Playlist({ order: "name" });
	p.setItems(make(5));
	assert.deepEqual(drain(p, 3), ["i0", "i1", "i2"]);
	assert.equal(p.previous().id, "i1");
	assert.equal(p.previous().id, "i0");
	assert.equal(p.previous(), null);
	assert.equal(p.next().id, "i1");
	assert.equal(p.next().id, "i2");
	assert.equal(p.next().id, "i3");
});

test("setItems mid-cycle keeps progress and adds new items to the remaining queue", () => {
	const p = new Playlist({ random: seeded(7) });
	const items = make(6);
	p.setItems(items);
	const seen = drain(p, 3);
	p.setItems([...items, { id: "new1" }, { id: "new2" }]);
	const rest = drain(p, 5);
	assert.equal(new Set([...seen, ...rest]).size, 8, "all 8 shown exactly once");
	assert.ok(rest.includes("new1") && rest.includes("new2"));
});

test("removed items are dropped from queue and history", () => {
	const p = new Playlist({ order: "name" });
	p.setItems(make(4));
	drain(p, 2); // i0, i1
	p.setItems(make(4).filter((i) => i.id !== "i0" && i.id !== "i2"));
	assert.equal(p.previous(), null, "i0 is gone from history");
	assert.equal(p.next().id, "i3");
});

test("filter limits playback and restarts the cycle", () => {
	const p = new Playlist({ random: seeded(3) });
	p.setItems(make(10, (i) => ({ dirs: [i % 2] })));
	drain(p, 4);
	p.setFilter((item) => item.dirs.includes(1));
	assert.equal(p.size, 5);
	const ids = drain(p, 5);
	assert.equal(new Set(ids).size, 5);
	assert.ok(ids.every((id) => Number(id.slice(1)) % 2 === 1));
	p.setFilter(null);
	assert.equal(p.size, 10);
});

test("filter that matches nothing returns null instead of looping", () => {
	const p = new Playlist();
	p.setItems(make(3));
	p.setFilter(() => false);
	assert.equal(p.next(), null);
});

test("single item repeats", () => {
	const p = new Playlist();
	p.setItems(make(1));
	assert.deepEqual(drain(p, 3), ["i0", "i0", "i0"]);
});

test("history is capped", () => {
	const p = new Playlist({ order: "name", historySize: 5 });
	p.setItems(make(20));
	drain(p, 12);
	let back = 0;
	while (p.previous()) back++;
	assert.equal(back, 4);
});
