const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp"]);

/**
 * Expand a leading ~ and resolve relative paths against baseDir (the MagicMirror root).
 * @param {string} p path from config
 * @param {string} baseDir base for relative paths
 * @returns {string} absolute path
 */
function expandPath (p, baseDir) {
	if (p === "~" || p.startsWith("~/")) p = path.join(os.homedir(), p.slice(1));
	return path.resolve(baseDir, p);
}

/**
 * Normalise "jpg,png" or ["jpg","png"] into a lowercase Set without dots.
 * @param {string|string[]} extensions extension list
 * @returns {Set<string>} extensions
 */
function parseExtensions (extensions) {
	const list = Array.isArray(extensions) ? extensions : String(extensions).split(",");
	return new Set(list.map((e) => e.trim().toLowerCase().replace(/^\./, "")).filter(Boolean));
}

/**
 * @param {string} file path or name
 * @returns {"image"|"video"} media type by extension
 */
function mediaType (file) {
	return IMAGE_EXTENSIONS.has(path.extname(file).slice(1).toLowerCase()) ? "image" : "video";
}

/**
 * Find media files under the configured paths.
 * @param {object} opts options
 * @param {string[]} opts.mediaPaths directories (or single files) to scan
 * @param {boolean} opts.recursive descend into subdirectories
 * @param {string[]} opts.excludePaths directory names to skip
 * @param {string|string[]} opts.extensions allowed extensions
 * @param {string} opts.baseDir base for relative paths
 * @param {Function} opts.onError called with (path, error) for unreadable paths
 * @returns {{path: string, type: string, size: number, mtime: number}[]} files found
 */
function scan ({ mediaPaths, recursive = true, excludePaths = [], extensions, baseDir = process.cwd(), onError = () => {} }) {
	const allowed = parseExtensions(extensions);
	const excluded = new Set(excludePaths);
	const seen = new Set();
	const results = [];

	const addFile = (file, stat) => {
		if (seen.has(file)) return;
		if (!allowed.has(path.extname(file).slice(1).toLowerCase())) return;
		seen.add(file);
		results.push({ path: file, type: mediaType(file), size: stat.size, mtime: stat.mtimeMs });
	};

	const walk = (dir) => {
		let entries;
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch (error) {
			onError(dir, error);
			return;
		}
		for (const entry of entries) {
			if (entry.name.startsWith(".")) continue;
			const full = path.join(dir, entry.name);
			let stat;
			try {
				// stat (not lstat) so symlinked folders/files on NAS mounts work
				stat = fs.statSync(full);
			} catch (error) {
				onError(full, error);
				continue;
			}
			if (stat.isDirectory()) {
				if (recursive && !excluded.has(entry.name)) walk(full);
			} else if (stat.isFile()) {
				addFile(full, stat);
			}
		}
	};

	for (const p of mediaPaths) {
		const abs = expandPath(p, baseDir);
		let stat;
		try {
			stat = fs.statSync(abs);
		} catch (error) {
			onError(abs, error);
			continue;
		}
		if (stat.isDirectory()) walk(abs);
		else if (stat.isFile()) addFile(abs, stat);
	}
	return results;
}

module.exports = { scan, expandPath, parseExtensions, mediaType };
