# MMM-BackgroundMedia

A [MagicMirror²](https://github.com/MagicMirrorOrg/MagicMirror) module that plays a full-screen slideshow of **photos and videos** behind your other modules.

- Photos: **jpg/jpeg, png**. Videos: **mov, mpeg/mpg, mp4, m4v**.
- Videos the mirror can't play smoothly are **converted automatically** with ffmpeg, once, and cached. This covers MPEG-1/2, iPhone HEVC/ProRes, 4K, and high-frame-rate clips. Limits are tuned for a **Raspberry Pi 4 or 5**.
- Crossfades between items, plus a blurred backdrop behind portrait photos, a readability gradient, a progress bar, and an info overlay.
- Remote or keyboard control via [MMM-KeyBindings](https://github.com/shbatm/MMM-KeyBindings): next, previous, play/pause, replay, info, and a **folder picker** to play everything or only certain folders.
- Can be controlled from other modules with notifications (e.g. MMM-Remote-Control, voice modules).
- Videos are always muted.

## Install

On the mirror:

```bash
sudo apt install ffmpeg
cd ~/MagicMirror/modules
git clone https://github.com/kritch83/MMM-BackgroundMedia.git
cd MMM-BackgroundMedia
npm install --omit=dev
```

`ffmpeg` provides both `ffmpeg` (conversion) and `ffprobe` (inspecting videos). Without them, photos still work and only `.mp4/.m4v/.mov` files are tried as-is.

## Configure

Minimal `config/config.js` entry:

```js
{
	module: "MMM-BackgroundMedia",
	position: "fullscreen_below",
	config: {
		mediaPaths: ["~/Pictures/Mirror"],
		device: "auto" // or "rpi4" / "rpi5"
	}
},
```

### Options

| Option | Default | Description |
|---|---|---|
| `mediaPaths` | `["modules/MMM-BackgroundMedia/media"]` | Folders (or single files) to play. Absolute, `~/…`, or relative to the MagicMirror folder. Mounted NAS shares work. |
| `recursive` | `true` | Include subfolders. |
| `excludePaths` | `["@eaDir", "#recycle", "#snapshot"]` | Folder names to skip. Hidden folders (`.something`) are always skipped. |
| `extensions` | `"jpg,jpeg,png,mov,mp4,m4v,mpg,mpeg"` | File types to include. |
| `rescanInterval` | `1800000` (30 min) | How often to look for new or removed files, in ms. `0` = only at startup. |
| `order` | `"shuffle"` | `"shuffle"` (every item once before any repeats), `"name"` (natural sort by path), or `"date"` (capture date from EXIF / video metadata, falling back to file date). |
| `sortDescending` | `false` | Reverse `name` / `date` order. |
| `imageDuration` | `15000` | How long each photo shows, in ms. |
| `maxVideoDuration` | `0` | Cut videos off after this many ms. `0` = play the whole video. |
| `shortVideoLength` | `10000` | Videos shorter than this many ms count as "short" for the two options below. |
| `videoSlowdown` | `"short"` | Which videos ease to a stop at the end: `"off"`, `"short"`, or `"all"`. See [Video endings](#video-endings). |
| `slowdownDuration` | `1000` | How long the slow-down takes on screen, in ms. |
| `videoFreeze` | `"short"` | Which videos then hold their last frame: `"off"`, `"short"`, or `"all"`. |
| `freezeDuration` | `3000` | How long the hold lasts, in ms. Pausing freezes it, and replay plays the clip again. The old name `shortVideoDelay` still works. |
| `transitionDuration` | `1500` | Crossfade length in ms. `0` = hard cut. |
| `fit` | `"contain-blur"` | `"contain-blur"`: whole picture, empty space filled with a blurred copy. `"contain"`: whole picture, black bars. `"cover"`: fill the screen, crop edges. |
| `position` | `"center"` | CSS `object-position` for the media, e.g. `"top"`. |
| `showInfo` | `false` | Show the info overlay at startup. It can also be toggled with a key. |
| `infoLocation` | `"bottomRight"` | `bottomRight`, `bottomLeft`, `topRight`, `topLeft`. |
| `infoFields` | `["name", "date"]` | Any of `name`, `date`, `folder`. |
| `dateFormat` | `{ dateStyle: "long" }` | [`Intl.DateTimeFormat` options](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/DateTimeFormat#options). Uses the mirror's `language`. |
| `showProgressBar` | `true` | Thin bar at the bottom showing time left on the current item. For videos it covers the slow-down and freeze too, so it reaches the end just as the next item starts. |
| `showIndicator` | `true` | Briefly show an icon (⏭ ⏮ ⏸ ▶ ↻) when a command is received. |
| `showGradient` | `true` | Darken the edges so other modules stay readable. |
| `showConversionStatus` | `true` | While videos are being converted, show a small card with the file name, "Converting 2 of 5", and percent done. |
| `conversionStatusLocation` | `"bottomLeft"` | `bottomLeft`, `bottomRight`, `topLeft`, `topRight`. |
| `gradientDirection` | `"vertical"` | `vertical`, `horizontal`, `both`, or `radial`. Stops are set with `gradient`, `horizontalGradient` and `radialGradient`; the defaults match MMM-BackgroundSlideshow. |
| `folderDepth` | `1` | How many subfolder levels the folder picker lists below each media folder. |
| `rememberFolderSelection` | `true` | Keep the folder selection across restarts. |
| `menuTimeout` | `30000` | Close the folder picker after this many ms without a key press. |
| `device` | `"auto"` | `"auto"` (read the Pi model), `"rpi4"`, `"rpi5"`, or `"generic"`. See below. |
| `videoProfile` | `{}` | Override profile values, e.g. `{ maxFps: 25, bitrate: "4M" }`. |
| `transcode` | `true` | Convert unplayable videos. If `false`, they're skipped. |
| `cacheDir` | `<module>/cache` | Where converted videos and the saved folder selection go. A USB drive is a good choice for large libraries. |
| `ffmpegPath` / `ffprobePath` | `"ffmpeg"` / `"ffprobe"` | Binaries to use. |
| `keyBindings` | see below | Key mapping. You can override a single action without repeating the rest. |

### Device profiles

MagicMirror's Electron browser decodes video in software on both Pis. Any video above these limits, or in a format Chromium can't play, is converted to H.264 MP4 with no audio:

| `device` | Plays as-is up to | Conversion encoder | Bitrate |
|---|---|---|---|
| `rpi4` | 1080p, 30 fps | `h264_v4l2m2m` (hardware), falling back to `libx264` | 5M |
| `rpi5` | 1080p, 60 fps | `libx264` (the Pi 5 has no H.264 encoder) | 8M |
| `generic` | 2160p, 60 fps (VP9/AV1 allowed) | `libx264` | 10M |

`"auto"` reads `/proc/device-tree/model`. Older Pis use the `rpi4` limits, and anything that isn't a Pi uses `generic`. The log shows which profile was picked.

**First run:** conversion happens in the background, one file at a time, at low priority. Photos and already-playable videos show immediately, and converted videos join the slideshow as each finishes. Conversion on a Pi is slow; 4K iPhone (HEVC) clips can take several times their own length. Results are cached, keyed to the file and to the output's size and frame rate, so each file is only converted once. Moving to a Pi 5 reuses the cache; only clips above 30 fps are re-converted, to keep their full frame rate. Cached files for deleted videos are cleaned up on rescan. If the browser fails on a video that looked playable, that file is converted automatically.

### Video endings

At the end of a video it can ease to a stop and then rest on its last frame before the next item:

```js
videoSlowdown: "short", videoFreeze: "short", // default: clips under 10 s slow down and freeze
videoSlowdown: "off",                         // no slow-down; short clips still freeze
videoSlowdown: "all", videoFreeze: "all",     // every video slows down and freezes
```

The slow-down is an even "braking" curve. A 1 s `slowdownDuration` plays the last half-second of footage over one second, stopping exactly on the last frame. Pausing during it holds the frame, and replay restarts at normal speed.

## Keys (MMM-KeyBindings)

Install [MMM-KeyBindings](https://github.com/shbatm/MMM-KeyBindings) and add it to your config. This module listens for its `KEYPRESS` notifications.

| Action | Default keys |
|---|---|
| Next | `ArrowRight`, `MediaNextTrack` |
| Previous | `ArrowLeft`, `MediaPreviousTrack` |
| Play / pause | `Enter`, `MediaPlayPause` |
| Replay current item (also resumes) | `ArrowUp` |
| Toggle info overlay | `ArrowDown`, `i` |
| Open folder picker | `Menu` |
| Re-convert the current video (press twice within 3 s) | `c` |
| Delete all converted videos and convert again (press twice within 3 s) | `Shift`+`C` |

While paused, Next and Previous still move between items, so you can browse at your own pace.

**Re-converting.** `c` deletes the converted copy of the video on screen, skips to the next item, and converts that file again; use it if a converted video looks wrong. `Shift`+`C` does the same for every converted video, so the whole library is converted again, which takes a long time on a Pi. Both need a second press within 3 seconds; the first only shows a prompt. Your folder selection isn't affected. Letter keys need adding to MMM-KeyBindings' `handleKeys` (see below). On a remote, map spare buttons to `c`/`C` in its `keyMap`, or bind other keys with `clearVideoCache`/`clearAllCache`.

**Folder picker:** press `Menu`, then:
- `▲`/`▼` move.
- `OK`/`Enter` ticks or unticks a folder. Several can be ticked; "All media" clears them.
- `Back`/`Menu` closes the picker and plays only the ticked folders.

While the picker is open it takes key focus: MMM-KeyBindings switches to mode `BACKGROUNDMEDIA_MENU`, so other modules ignore the keys. When several `mediaPaths` are configured, each one appears as a folder, with its subfolders indented beneath it.

Example with a USB keyboard, where `m` opens the picker:

```js
{
	module: "MMM-KeyBindings",
	config: {
		enableKeyboard: true,
		evdev: { enabled: false }, // true for a Bluetooth remote, see MMM-KeyBindings docs
		handleKeys: ["m", "c", "C"]
	}
},
{
	module: "MMM-BackgroundMedia",
	position: "fullscreen_below",
	config: {
		mediaPaths: ["~/Pictures/Mirror"],
		keyBindings: {
			map: { folderMenu: ["Menu", "m"] },
			menuMap: { close: ["Return", "Menu", "m"] }
		}
	}
},
```

Full `keyBindings` defaults:

```js
keyBindings: {
	enabled: true,
	mode: "DEFAULT",                 // only react while MMM-KeyBindings is in this mode
	menuMode: "BACKGROUNDMEDIA_MENU",
	map: {
		next: ["ArrowRight", "MediaNextTrack"],
		previous: ["ArrowLeft", "MediaPreviousTrack"],
		playPause: ["Enter", "MediaPlayPause"],
		replay: ["ArrowUp"],
		toggleInfo: ["ArrowDown", "i"],
		folderMenu: ["Menu"],
		clearVideoCache: ["c"],
		clearAllCache: ["C"]
	},
	menuMap: {
		up: ["ArrowUp"],
		down: ["ArrowDown"],
		select: ["Enter", "MediaPlayPause"],
		close: ["Return", "Menu"]          // MMM-KeyBindings maps Escape/Backspace to "Return"
	}
}
```

Key names are those MMM-KeyBindings sends. For a remote, these come from its `keyMap`, e.g. `KEY_MENU` → `Menu` and `KEY_BACK` → `Return`. If your remote's OK button sends something else (e.g. `KEY_ENTER`, `KEY_SELECT`), add it to MMM-KeyBindings' `keyMap` as `Enter`. Only short presses (`KEY_PRESSED`) are used.

## Notifications

Other modules can control the slideshow:

| Notification | Payload | Effect |
|---|---|---|
| `BACKGROUNDMEDIA_NEXT` / `_PREVIOUS` | – | Next / previous item |
| `BACKGROUNDMEDIA_PAUSE` / `_PLAY` / `_PLAYPAUSE` | – | Pause / resume / toggle |
| `BACKGROUNDMEDIA_REPLAY` | – | Restart the current photo timer or video |
| `BACKGROUNDMEDIA_TOGGLE_INFO` | – | Show or hide the info overlay |
| `BACKGROUNDMEDIA_FOLDER_MENU` | – | Open or close the folder picker |
| `BACKGROUNDMEDIA_SELECT_FOLDERS` | `"all"`, or folder names: `["Family", "Vacation"]` / `{ folders: [...] }` | Choose which folders play. Names match the picker label (`"media2 / Pets"`) or just the last part (`"Pets"`). |
| `BACKGROUNDMEDIA_RESCAN` | – | Look for new or removed files now |
| `BACKGROUNDMEDIA_CLEAR_VIDEO_CACHE` | – | Re-convert the current video (no press-twice confirmation) |
| `BACKGROUNDMEDIA_CLEAR_ALL_CACHE` | – | Delete all converted videos and convert them again (no confirmation) |

Example with MMM-KeyBindings sending a notification on a long press:

```js
actions: [{ key: "ArrowRight", state: "KEY_LONGPRESSED", notification: "BACKGROUNDMEDIA_SELECT_FOLDERS", payload: "all" }]
```

When the module is hidden (e.g. by MMM-Pir or a page-switching module), playback pauses and resumes when it's shown again.

## Using with MMM-Carousel

The two work together without changing MMM-Carousel, so it stays `git pull`-able.

**Give MMM-Carousel a `position`.** Carousel requires one, e.g. `"bottom_bar"`, even if you don't show page indicators. Without it Carousel never starts, so the pages never rotate.

**Choose where the background appears.** In `slides` mode, list `"MMM-BackgroundMedia"` on each page that should show it:

```js
{
	module: "MMM-Carousel",
	position: "bottom_bar",
	config: {
		mode: "slides",
		slides: {
			main: ["clock", "weather", "MMM-BackgroundMedia"],
			photos: ["MMM-BackgroundMedia"],
			news: ["newsfeed"]
		}
	}
},
```

- Moving between two pages that both list it (`main` → `photos`), the background stays up and keeps playing instead of fading out and in.
- On pages without it (`news`), it's hidden and paused, and continues where it left off when it comes back.
- To show it on every page, add `"MMM-BackgroundMedia"` to Carousel's `ignoreModules` instead.
- In Carousel's default `global` mode, every module, including the background, becomes a page of its own, shown one at a time. Use `slides` (or `ignoreModules`) instead.

**Keys.** While MMM-Carousel is running with key bindings, BackgroundMedia leaves Carousel's keys to Carousel. By default those are `→` (next page), `←` (previous page), `↓` (pause rotation) and `Home`. The background is then controlled with:
- the remote's media keys (`⏩`/`⏪` for next/previous, `⏯` for play/pause)
- `Enter` (play/pause), `↑` (replay), `i` (info overlay), `Menu` (folder picker), `c`/`C` (re-convert)

Add `"i"` to MMM-KeyBindings' `handleKeys` for a keyboard. While the folder picker is open, the arrows go to the picker, not to Carousel. If you'd rather the arrows control the background, map them in BackgroundMedia's own `keyBindings.map`, which overrides this, and move Carousel's keys in your `config.js`.

## Troubleshooting

- **"No photos or videos found"**: check `mediaPaths` and look in the MagicMirror log for `cannot read …`.
- **A video never shows up**: the log says whether it's `queued for transcoding`, `transcoding`, or was skipped, and why.
- **Choppy video on a Pi 4**: lower the limits, e.g. `videoProfile: { maxShortSide: 720 }`. Delete the cache folder to re-convert existing clips.

## Development

```bash
npm install
npm test
```

## Credits

Inspired by [MMM-BackgroundSlideshow](https://github.com/darickc/MMM-BackgroundSlideshow) (MIT). This module uses a similar file-serving route, gradient options, and notification naming.

## License

MIT
