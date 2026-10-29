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

Every option is optional except `mediaPaths`, which you'll want to set. Durations are in milliseconds. A block with every option at its default value is [below the tables](#all-options-with-their-defaults).

#### Library

| Option | Default | Description |
|---|---|---|
| `mediaPaths` | `["modules/MMM-BackgroundMedia/media"]` | Folders (or single files) to play. Absolute, `~/…`, or relative to the MagicMirror folder. Mounted NAS shares work. |
| `recursive` | `true` | Include subfolders. |
| `excludePaths` | `["@eaDir", "#recycle", "#snapshot"]` | Folder names to skip. Hidden folders (`.something`, including `.deleted`) are always skipped. |
| `extensions` | `"jpg,jpeg,png,mov,mp4,m4v,mpg,mpeg"` | File types to include. |
| `rescanInterval` | `1800000` (30 min) | How often to look for new or removed files. `0` = only at startup. |

#### Playback

| Option | Default | Description |
|---|---|---|
| `order` | `"shuffle"` | `"shuffle"` (every item once before any repeats), `"name"` (natural sort by path), or `"date"` (capture date from EXIF / video metadata, falling back to file date). |
| `sortDescending` | `false` | Reverse `name` / `date` order. |
| `imageDuration` | `15000` | How long each photo shows. |
| `maxVideoDuration` | `0` | Cut videos off after this long. `0` = play the whole video. |
| `fit` | `"contain-blur"` | `"contain-blur"`: whole picture, empty space filled with a blurred copy. `"contain"`: whole picture, black bars. `"cover"`: fill the screen, crop edges. |
| `position` | `"center"` | CSS `object-position` for the media, e.g. `"top"`. |

#### Transitions

| Option | Default | Description |
|---|---|---|
| `transitionStyle` | `"crossfade"` | `"crossfade"`: the next item fades in while the current one fades out. `"black"`: the current item fades out to black, then the next one fades in. See [Transitions](#transitions). |
| `transitionDuration` | `1500` | Default length of both fades. `0` = hard cut. |
| `fadeOutDuration` | `null` | How long the current item takes to fade out. `null` = `transitionDuration`. |
| `fadeInDuration` | `null` | How long the next item takes to fade in. `null` = `transitionDuration`. |
| `blackDuration` | `0` | With `transitionStyle: "black"`, how long to stay on black between the fade-out and the fade-in. |

#### Video endings and short videos

| Option | Default | Description |
|---|---|---|
| `shortVideoLength` | `10000` | Videos shorter than this count as "short" for the options below. |
| `shortVideoStyle` | `"ending"` | How short videos play. `"ending"`: they use `videoSlowdown` / `videoFreeze`. `"midpause"`: they ease to a stop partway, hold, ease back up, and fade out just before the end. See [Mid-pause style](#mid-pause-style-for-short-videos). |
| `videoSlowdown` | `"short"` | Which videos ease to a stop at the end: `"off"`, `"short"`, or `"all"`. See [Video endings](#video-endings). |
| `slowdownDuration` | `1000` | How long the slow-down takes on screen. In `"midpause"` style, the length of each ease (speed-up intro, slow-down into the pause, speed-up after it). |
| `videoFreeze` | `"short"` | Which videos then hold their last frame: `"off"`, `"short"`, or `"all"`. |
| `freezeDuration` | `3000` | How long the hold lasts (the end freeze, or the `"midpause"` hold). Pausing extends it, and replay plays the clip again. The old name `shortVideoDelay` still works. |
| `midPauseIntro` | `"fade"` | `"midpause"` only. `"fade"`: fade in at normal speed. `"speedup"`: start frozen and ease up to normal speed as it fades in. |
| `midPausePosition` | `0.5` | `"midpause"` only. Where to pause, as a fraction of the video. |
| `midPauseFadeOut` | `250` | `"midpause"` only. How long before the end the fade-out starts. It lasts exactly that long, so the video is fully faded at its last frame. |

#### Overlays

| Option | Default | Description |
|---|---|---|
| `showInfo` | `false` | Show the info overlay at startup. It can also be toggled with a key. |
| `infoLocation` | `"bottomRight"` | `bottomRight`, `bottomLeft`, `topRight`, `topLeft`. |
| `infoFields` | `["name", "date"]` | Any of `name`, `date`, `folder`. |
| `dateFormat` | `{ dateStyle: "long" }` | [`Intl.DateTimeFormat` options](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/DateTimeFormat#options). Uses the mirror's `language`. |
| `showProgressBar` | `true` | Thin bar at the bottom showing time left on the current item. For videos it covers any slow-down, freeze or mid-pause too, so it reaches the end just as the next item starts. |
| `showIndicator` | `true` | Briefly show an icon (⏭ ⏮ ⏸ ▶ ↻) when a command is received. Confirmation prompts (press twice, deleted) show either way. |
| `showConversionStatus` | `true` | While videos are being converted, show a small card with the file name, "Converting 2 of 5", and percent done. |
| `conversionStatusLocation` | `"bottomLeft"` | `bottomLeft`, `bottomRight`, `topLeft`, `topRight`. |
| `showGradient` | `true` | Darken the edges so other modules stay readable. |
| `gradientDirection` | `"vertical"` | `vertical` (uses `gradient`), `horizontal` (`horizontalGradient`), `both` (`gradient` and `horizontalGradient`), or `radial` (`radialGradient`). |
| `gradient` | `["rgba(0, 0, 0, 0.75) 0%", "rgba(0, 0, 0, 0) 40%", "rgba(0, 0, 0, 0) 80%", "rgba(0, 0, 0, 0.75) 100%"]` | Top-to-bottom colour stops. Defaults match MMM-BackgroundSlideshow. |
| `horizontalGradient` | same as `gradient` | Left-to-right colour stops. |
| `radialGradient` | `["rgba(0, 0, 0, 0) 0%", "rgba(0, 0, 0, 0) 75%", "rgba(0, 0, 0, 0.25) 100%"]` | Centre-outwards colour stops. |

#### Folders and deleting

| Option | Default | Description |
|---|---|---|
| `folderDepth` | `1` | How many subfolder levels the folder picker lists below each media folder. |
| `rememberFolderSelection` | `true` | Keep the folder selection across restarts. |
| `menuTimeout` | `30000` | Close the folder picker after this long without a key press. |
| `deletedFolder` | `null` | Where `d` moves files. By default, a hidden `.deleted` folder inside the media folder each file came from (same drive, so even big videos move instantly). Set a path to use one folder instead; files keep `<media folder name>/<subfolders>` under it. |
| `deletePresses` | `3` | How many presses of `d`... |
| `deletePressWindow` | `1000` | ...within how long, move the current file to the deleted folder. |

#### Video conversion

| Option | Default | Description |
|---|---|---|
| `device` | `"auto"` | `"auto"` (read the Pi model), `"rpi4"`, `"rpi5"`, or `"generic"`. Sets which videos play as-is and how others are converted. See [Device profiles](#device-profiles). |
| `videoProfile` | `{}` | Override profile values, e.g. `{ maxShortSide: 720, maxFps: 25, bitrate: "4M" }`. |
| `transcode` | `true` | Convert videos the mirror can't play smoothly. If `false`, they're skipped. |
| `cacheDir` | `null` (`<module>/cache`) | Where converted videos and the saved folder selection go. A USB drive is a good choice for large libraries. |
| `ffmpegPath` | `"ffmpeg"` | ffmpeg binary. |
| `ffprobePath` | `"ffprobe"` | ffprobe binary. |

#### Keys

| Option | Default | Description |
|---|---|---|
| `keyBindings.enabled` | `true` | Respond to MMM-KeyBindings key presses. Set `false` to drive everything from MMM-KeyBindings `actions` instead (see [below](#drive-everything-from-mmm-keybindings-actions)). |
| `keyBindings.mode` | `"DEFAULT"` | Only react while MMM-KeyBindings is in this mode. |
| `keyBindings.menuMode` | `"BACKGROUNDMEDIA_MENU"` | Mode MMM-KeyBindings is switched to while the folder picker is open. |
| `keyBindings.map` | see [Full key list](#full-key-list) | Keys for each action. Override one action without repeating the rest, e.g. `keyBindings: { map: { next: ["n"] } }`. |
| `keyBindings.menuMap` | see [Full key list](#full-key-list) | Keys inside the folder picker: `up`, `down`, `select`, `close`. |

#### All options with their defaults

<details>
<summary>Every option at its default value, ready to copy into <code>config.js</code></summary>

```js
{
	module: "MMM-BackgroundMedia",
	position: "fullscreen_below",
	config: {
		// Library
		mediaPaths: ["modules/MMM-BackgroundMedia/media"],
		recursive: true,
		excludePaths: ["@eaDir", "#recycle", "#snapshot"],
		extensions: "jpg,jpeg,png,mov,mp4,m4v,mpg,mpeg",
		rescanInterval: 1800000, // 30 min
		folderDepth: 1,
		rememberFolderSelection: true,
		deletedFolder: null, // default: a hidden ".deleted" folder in each media folder
		deletePresses: 3, // press "d" this many times...
		deletePressWindow: 1000, // ...within this many ms to move the current file to the deleted folder

		// Playback
		order: "shuffle", // "shuffle" | "name" | "date"
		sortDescending: false,
		imageDuration: 15000,
		maxVideoDuration: 0, // ms; 0 = play whole video
		shortVideoLength: 10000, // ms; videos shorter than this count as "short" below
		shortVideoStyle: "ending", // "ending": short videos use videoSlowdown/videoFreeze below | "midpause": see midPause* options
		midPauseIntro: "fade", // "midpause": "fade" in at normal speed | "speedup" from a standstill
		midPausePosition: 0.5, // "midpause": ease to a stop here (fraction of the video), hold freezeDuration, ease back up
		midPauseFadeOut: 250, // "midpause": ms before the end that the fade-out starts (it ends at the last frame)
		videoSlowdown: "short", // "off" | "short" | "all": ease to a stop at the end
		slowdownDuration: 1000, // ms the slow-down takes on screen
		videoFreeze: "short", // "off" | "short" | "all": then hold the last frame...
		freezeDuration: 3000, // ...for this long (ms) before moving on
		transitionDuration: 1500, // ms; default length of both fades. 0 = hard cut
		transitionStyle: "crossfade", // "crossfade" | "black": fade out to black, then fade the next item in
		fadeOutDuration: null, // ms; null = transitionDuration
		fadeInDuration: null, // ms; null = transitionDuration
		blackDuration: 0, // "black" style: ms to stay on black between fade-out and fade-in
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
		menuTimeout: 30000,

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
				clearAllCache: ["C"], // Shift+C: delete every converted video (press twice)
				deleteFile: ["d"] // move the current file to the deleted folder (press 3× within 1 s)
			},
			menuMap: {
				up: ["ArrowUp"],
				down: ["ArrowDown"],
				select: ["Enter", "MediaPlayPause"],
				close: ["Return", "Menu"] // MMM-KeyBindings maps Escape/Backspace to "Return"
			}
		}
	}
},
```

</details>

### Device profiles

MagicMirror's Electron browser decodes video in software on both Pis. Any video above these limits, or in a format Chromium can't play, is converted to H.264 MP4 with no audio:

| `device` | Plays as-is up to | Conversion encoder | Bitrate |
|---|---|---|---|
| `rpi4` | 1080p, 30 fps | `h264_v4l2m2m` (hardware), falling back to `libx264` | 5M |
| `rpi5` | 1080p, 60 fps | `libx264` (the Pi 5 has no H.264 encoder) | 8M |
| `generic` | 2160p, 60 fps (VP9/AV1 allowed) | `libx264` | 10M |

`"auto"` reads `/proc/device-tree/model`. Older Pis use the `rpi4` limits, and anything that isn't a Pi uses `generic`. The log shows which profile was picked.

**First run:** conversion happens in the background, one file at a time, at low priority. Photos and already-playable videos show immediately, and converted videos join the slideshow as each finishes. Conversion on a Pi is slow; 4K iPhone (HEVC) clips can take several times their own length. Results are cached, keyed to the file and to the output's size and frame rate, so each file is only converted once. Moving to a Pi 5 reuses the cache; only clips above 30 fps are re-converted, to keep their full frame rate. Cached files for deleted videos are cleaned up on rescan. If the browser fails on a video that looked playable, that file is converted automatically.

### Mid-pause style for short videos

```js
shortVideoStyle: "midpause", midPauseIntro: "speedup", freezeDuration: 2000, midPauseFadeOut: 250
```

With `shortVideoStyle: "midpause"`, each short video (under `shortVideoLength`):
1. Fades in. With `midPauseIntro: "speedup"`, it also starts frozen and eases up to normal speed.
2. Eases to a stop at `midPausePosition` (halfway by default), holds the frame for `freezeDuration`, then eases back up.
3. Plays the rest, and starts fading out `midPauseFadeOut` ms before its end while still playing, as the next item comes in with your normal transition.

Each ease takes `slowdownDuration`. The end slow-down and end freeze don't apply to these videos. The progress bar covers the whole item, including the eases and the hold. Pausing during the hold extends it, and replay starts the video over. Longer videos are unaffected.

### Transitions

```js
transitionStyle: "crossfade",                              // default: the next item fades in over the current one
transitionStyle: "black", fadeOutDuration: 800, blackDuration: 300, fadeInDuration: 1200, // dip to black between items
```

With `"black"`, a photo's display time, the progress bar and video playback start when the next item begins to fade in, not during the black. The outgoing video keeps playing while it fades out.

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

### Full key list

| Action | Keyboard | Remote button | Action name | Notes |
|---|---|---|---|---|
| Next item | `→`, `⏭` media key | Right, `⏩` | `next` | |
| Previous item | `←`, `⏮` media key | Left, `⏪` | `previous` | |
| Play / pause | `Enter`, `⏯` media key | OK, `⏯` | `playPause` | Pauses a playing video too |
| Start the current item over | `↑` | Up | `replay` | Also resumes if paused |
| Info overlay on/off | `↓`, `i` | Down | `toggleInfo` | |
| Open the folder picker | `Menu` (context-menu key) | Menu | `folderMenu` | |
| Re-convert the current video | `c`, twice within 3 s | – | `clearVideoCache` | First press only shows a prompt |
| Delete all converted videos and convert again | `Shift`+`C`, twice within 3 s | – | `clearAllCache` | First press only shows a prompt |
| Move the current file to the deleted folder | `d`, 3× within 1 s | – | `deleteFile` | Holding the key does nothing |
| Pause / Resume / Rescan for new files | – | – | `pause` / `play` / `rescan` | No default key; bind one if you want |

While the folder picker is open:

| Action | Keyboard | Remote button | Action name |
|---|---|---|---|
| Move up | `↑` | Up | `menuUp` |
| Move down | `↓` | Down | `menuDown` |
| Tick / untick a folder | `Enter`, `⏯` | OK, `⏯` | `menuSelect` |
| Close and play the ticked folders | `Esc`, `Backspace`, `Menu` | Back, Menu | `menuClose` |

- **Action name**: use it to rebind a key in `keyBindings.map` (or `keyBindings.menuMap` for the picker, without the `menu` prefix: `up`, `down`, `select`, `close`), or as the payload of a `BACKGROUNDMEDIA_ACTION` notification (see [Notifications](#notifications)).
- **Letter keys** (`i`, `c`, `C`, `d`) must be listed in MMM-KeyBindings' `handleKeys`. On a remote, give spare buttons those names in MMM-KeyBindings' `keyMap`.
- **Remote buttons** come from MMM-KeyBindings' default `keyMap`: `KEY_LEFT`/`RIGHT`/`UP`/`DOWN`, `KEY_KPENTER` (OK), `KEY_MENU`, `KEY_BACK`, `KEY_PLAYPAUSE`, `KEY_FASTFORWARD` (⏩) and `KEY_REWIND` (⏪).
- **With MMM-Carousel**, `→`, `←`, `↓` and `Home` go to Carousel (see [Using with MMM-Carousel](#using-with-mmm-carousel)). Use the `⏩`/`⏪` media keys for next/previous and `i` for the info overlay.

While paused, Next and Previous still move between items, so you can browse at your own pace.

**Deleting.** Pressing `d` three times within a second moves the photo or video on screen out of your library into the deleted folder (see `deletedFolder`), and the slideshow goes on to the next item. Fewer presses, slower presses, or holding `d` down do nothing. Nothing is erased: to restore a file, move it back from `.deleted` (it's a hidden folder: `ls -a` shows it). It reappears at the next rescan, or straight away with `BACKGROUNDMEDIA_RESCAN`. If the file was a converted video, its converted copy is removed from the cache.

**Re-converting.** `c` deletes the converted copy of the video on screen, skips to the next item, and converts that file again; use it if a converted video looks wrong. `Shift`+`C` does the same for every converted video, so the whole library is converted again, which takes a long time on a Pi. Both need a second press within 3 seconds; the first only shows a prompt. Your folder selection isn't affected. Letter keys need adding to MMM-KeyBindings' `handleKeys` (see below). On a remote, map spare buttons to `c`/`C` in its `keyMap`, or bind other keys with `clearVideoCache`/`clearAllCache`.

**Folder picker.** Several folders can be ticked; "All media" clears them. Closing the picker plays only the ticked folders, and the choice is remembered across restarts. While the picker is open it takes key focus: MMM-KeyBindings switches to mode `BACKGROUNDMEDIA_MENU`, so other modules ignore the keys. When several `mediaPaths` are configured, each one appears as a folder, with its subfolders indented beneath it.

Example with a USB keyboard, where `m` opens the picker:

```js
{
	module: "MMM-KeyBindings",
	config: {
		enableKeyboard: true,
		evdev: { enabled: false }, // true for a Bluetooth remote, see MMM-KeyBindings docs
		handleKeys: ["m", "c", "C", "d"]
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
		clearAllCache: ["C"],
		deleteFile: ["d"]
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
| `BACKGROUNDMEDIA_DELETE_CURRENT` | – | Move the current file to the deleted folder (no press count) |
| `BACKGROUNDMEDIA_ACTION` | an action name, e.g. `"next"` or `{ action: "next" }` | Exactly what that action's key does, including press counts and confirmations. Actions: `next`, `previous`, `playPause`, `pause`, `play`, `replay`, `toggleInfo`, `folderMenu`, `rescan`, `clearVideoCache`, `clearAllCache`, `deleteFile`; while the folder picker is open: `menuUp`, `menuDown`, `menuSelect`, `menuClose`. |

Example with MMM-KeyBindings sending a notification on a long press:

```js
actions: [{ key: "ArrowRight", state: "KEY_LONGPRESSED", notification: "BACKGROUNDMEDIA_SELECT_FOLDERS", payload: "all" }]
```

### Drive everything from MMM-KeyBindings actions

Instead of the built-in keys, you can map every key yourself in MMM-KeyBindings' `actions`, so all key setup lives in one place. Turn the built-in keys off so nothing fires twice, then send `BACKGROUNDMEDIA_ACTION` from MMM-KeyBindings. This block reproduces all the default keys:

```js
{
	module: "MMM-KeyBindings",
	config: {
		enableKeyboard: true,
		handleKeys: ["i", "c", "C", "d"],
		actions: [
			{ key: "ArrowRight", mode: "DEFAULT", notification: "BACKGROUNDMEDIA_ACTION", payload: "next" },
			{ key: "MediaNextTrack", mode: "DEFAULT", notification: "BACKGROUNDMEDIA_ACTION", payload: "next" },
			{ key: "ArrowLeft", mode: "DEFAULT", notification: "BACKGROUNDMEDIA_ACTION", payload: "previous" },
			{ key: "MediaPreviousTrack", mode: "DEFAULT", notification: "BACKGROUNDMEDIA_ACTION", payload: "previous" },
			{ key: "Enter", mode: "DEFAULT", notification: "BACKGROUNDMEDIA_ACTION", payload: "playPause" },
			{ key: "MediaPlayPause", mode: "DEFAULT", notification: "BACKGROUNDMEDIA_ACTION", payload: "playPause" },
			{ key: "ArrowUp", mode: "DEFAULT", notification: "BACKGROUNDMEDIA_ACTION", payload: "replay" },
			{ key: "ArrowDown", mode: "DEFAULT", notification: "BACKGROUNDMEDIA_ACTION", payload: "toggleInfo" },
			{ key: "i", mode: "DEFAULT", notification: "BACKGROUNDMEDIA_ACTION", payload: "toggleInfo" },
			{ key: "Menu", mode: "DEFAULT", notification: "BACKGROUNDMEDIA_ACTION", payload: "folderMenu" },
			{ key: "c", mode: "DEFAULT", notification: "BACKGROUNDMEDIA_ACTION", payload: "clearVideoCache" },
			{ key: "C", mode: "DEFAULT", notification: "BACKGROUNDMEDIA_ACTION", payload: "clearAllCache" },
			{ key: "d", mode: "DEFAULT", notification: "BACKGROUNDMEDIA_ACTION", payload: "deleteFile" },
			// While the folder picker is open, MMM-KeyBindings is in mode "BACKGROUNDMEDIA_MENU":
			{ key: "ArrowUp", mode: "BACKGROUNDMEDIA_MENU", notification: "BACKGROUNDMEDIA_ACTION", payload: "menuUp" },
			{ key: "ArrowDown", mode: "BACKGROUNDMEDIA_MENU", notification: "BACKGROUNDMEDIA_ACTION", payload: "menuDown" },
			{ key: "Enter", mode: "BACKGROUNDMEDIA_MENU", notification: "BACKGROUNDMEDIA_ACTION", payload: "menuSelect" },
			{ key: "Return", mode: "BACKGROUNDMEDIA_MENU", notification: "BACKGROUNDMEDIA_ACTION", payload: "menuClose" },
			{ key: "Menu", mode: "BACKGROUNDMEDIA_MENU", notification: "BACKGROUNDMEDIA_ACTION", payload: "menuClose" }
		]
	}
},
{
	module: "MMM-BackgroundMedia",
	position: "fullscreen_below",
	config: {
		mediaPaths: ["~/Pictures/Mirror"],
		keyBindings: { enabled: false } // keys come from MMM-KeyBindings' actions above
	}
},
```

- Remove lines you don't want, or change `key` to any key name MMM-KeyBindings sends. Letters must also be in `handleKeys`, and remote buttons need an entry in MMM-KeyBindings' `keyMap`.
- Giving MMM-KeyBindings an `actions` list replaces its default one. Its default is a long press of Home to toggle the monitor; copy that entry in if you use it.
- With MMM-Carousel, leave out keys Carousel uses (by default `ArrowRight`, `ArrowLeft`, `ArrowDown` and `Home`). Otherwise both modules act on them.

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
