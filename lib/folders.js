const path = require("node:path");

/**
 * Compare two segment arrays naturally ("Trip 2" before "Trip 10").
 * @param {Array} a sort key
 * @param {Array} b sort key
 * @returns {number} comparison
 */
function compareKeys (a, b) {
	for (let i = 0; i < Math.min(a.length, b.length); i++) {
		const diff = typeof a[i] === "number" ? a[i] - b[i] : String(a[i]).localeCompare(String(b[i]), undefined, { numeric: true, sensitivity: "base" });
		if (diff) return diff;
	}
	return a.length - b.length;
}

/**
 * Build the list of selectable folders and which of them each file belongs to.
 * With several roots every root is a folder; subfolders are listed down to `depth`
 * levels below their root. A folder contains everything beneath it.
 * @param {string[]} roots absolute media roots, in config order
 * @param {{path: string}[]} files scanned files
 * @param {number} depth subfolder levels to list (0 = roots only)
 * @returns {{folders: {id: string, label: string, depth: number, count: number}[], fileDirs: Map<string, number[]>}} folder list and per-file folder indices
 */
function buildFolders (roots, files, depth) {
	const multiRoot = roots.length > 1;
	const byId = new Map();
	const fileIds = new Map();

	for (const file of files) {
		// Longest matching root wins in case roots are nested.
		let rootIndex = -1;
		for (let i = 0; i < roots.length; i++) {
			if (file.path.startsWith(roots[i] + path.sep) && (rootIndex < 0 || roots[i].length > roots[rootIndex].length)) rootIndex = i;
		}
		if (rootIndex < 0) continue;
		const root = roots[rootIndex];
		const rel = path.relative(root, path.dirname(file.path));
		const segments = rel ? rel.split(path.sep) : [];
		const rootName = path.basename(root);

		const ids = [];
		const add = (id, label, level, key) => {
			if (!byId.has(id)) byId.set(id, { id, label, depth: level, count: 0, key });
			byId.get(id).count++;
			ids.push(id);
		};
		if (multiRoot) add(root, rootName, 0, [rootIndex]);
		for (let d = 1; d <= Math.min(depth, segments.length); d++) {
			const sub = segments.slice(0, d);
			const label = (multiRoot ? [rootName, ...sub] : sub).join(" / ");
			add(path.join(root, ...sub), label, multiRoot ? d : d - 1, [rootIndex, ...sub]);
		}
		fileIds.set(file.path, ids);
	}

	const sorted = [...byId.values()].sort((a, b) => compareKeys(a.key, b.key));
	const index = new Map(sorted.map((f, i) => [f.id, i]));
	const folders = sorted.map(({ id, label, depth: level, count }) => ({ id, label, depth: level, count }));
	const fileDirs = new Map();
	for (const [file, ids] of fileIds) fileDirs.set(file, ids.map((id) => index.get(id)));
	return { folders, fileDirs };
}

module.exports = { buildFolders };
