const fs = require("node:fs");
const path = require("node:path");

/**
 * Where a deleted file goes: <media folder>/.deleted/<subfolders>/<name> (same drive, and the
 * scanner skips hidden folders), or with a custom folder <deletedFolder>/<media folder name>/<subfolders>/<name>.
 * @param {object} opts options
 * @param {string} opts.file absolute path of the file
 * @param {string} [opts.root] the media folder it was found in
 * @param {string} [opts.deletedFolder] custom absolute folder
 * @returns {string} destination path (before collision handling)
 */
function deletedPath ({ file, root, deletedFolder }) {
	const rel = root ? path.relative(root, file) : path.basename(file);
	if (deletedFolder) return path.join(deletedFolder, root ? path.basename(root) : "", rel);
	return path.join(root || path.dirname(file), ".deleted", rel);
}

/**
 * "a.jpg" → "a (2).jpg", "a (3).jpg", … until the name is free.
 * @param {string} dest wanted path
 * @returns {string} free path
 */
function freePath (dest) {
	if (!fs.existsSync(dest)) return dest;
	const { dir, name, ext } = path.parse(dest);
	for (let n = 2; ; n++) {
		const candidate = path.join(dir, `${name} (${n})${ext}`);
		if (!fs.existsSync(candidate)) return candidate;
	}
}

/**
 * Move a file into the deleted folder; falls back to copy + delete across drives.
 * @param {object} opts see deletedPath
 * @returns {Promise<string>} where the file ended up
 */
async function moveToDeleted (opts) {
	const dest = freePath(deletedPath(opts));
	await fs.promises.mkdir(path.dirname(dest), { recursive: true });
	try {
		await fs.promises.rename(opts.file, dest);
	} catch (error) {
		if (error.code !== "EXDEV") throw error;
		const stat = await fs.promises.stat(opts.file);
		await fs.promises.copyFile(opts.file, dest, fs.constants.COPYFILE_EXCL);
		// Keep the file date so "date" ordering still works after a restore.
		await fs.promises.utimes(dest, stat.atime, stat.mtime);
		await fs.promises.unlink(opts.file);
	}
	return dest;
}

module.exports = { moveToDeleted, deletedPath, freePath };
