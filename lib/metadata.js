let exifr = null;
try {
	exifr = require("exifr");
} catch {
	// Optional: without it, photos fall back to the file's modified time.
}

// Cameras with unset clocks write 1970/1904 epochs; treat anything older as unknown.
const EARLIEST = Date.UTC(1990, 0, 1);

/**
 * @param {*} value date-ish
 * @returns {number|null} epoch ms, or null when missing/implausible
 */
function validDate (value) {
	if (!value) return null;
	const t = new Date(value).getTime();
	return Number.isFinite(t) && t >= EARLIEST ? t : null;
}

/**
 * Capture date from EXIF.
 * @param {string} file image path
 * @returns {Promise<number|null>} epoch ms
 */
async function imageDate (file) {
	if (!exifr) return null;
	try {
		const tags = await exifr.parse(file, { pick: ["DateTimeOriginal", "CreateDate"] });
		return validDate(tags && (tags.DateTimeOriginal || tags.CreateDate));
	} catch {
		return null;
	}
}

/**
 * Capture date from an ffprobe summary.
 * @param {object|null} info probe summary
 * @returns {number|null} epoch ms
 */
function videoDate (info) {
	return validDate(info && info.creationTime);
}

module.exports = { imageDate, videoDate, validDate };
