# Image Compressor · TekiDeki

A batch image compressor that runs entirely in the browser. Drop in a folder of photos, get smaller files back - and get them back **with the EXIF, GPS and device metadata removed**. No account, no backend, no CDN, no upload of any kind: the only thing that ever leaves your machine is the file you download.

[Live app](https://tekideki.github.io/Image-Compressor/) · [Apache-2.0](LICENSE) · [Support with a coffee](https://paypal.me/TekiDeki)

## What it does

- **Batch compression**: drag and drop, pick files, or paste a screenshot with `Ctrl+V`. Up to 60 images per run, 40 MB per image.
- **Per-file before and after**: every row shows the original size, the new size, the saving in percent and the output dimensions, plus a totals row for the whole batch.
- **Quality and size control**: output quality from 40% to 95% (default 78%) and a maximum width (default 1600 px) applied while keeping the aspect ratio. Images are never enlarged.
- **Output format**: keep the source format automatically, or force JPEG, WebP or PNG. WebP is only offered when the browser can actually encode it.
- **Metadata removal is the point, not a side effect**: EXIF, GPS coordinates, camera make and model, timestamps and software tags do not survive into the output, because the output is a fresh canvas encode rather than a copied file. What was found in the original (device, date, GPS, orientation) is shown next to the result so you can see what you are removing.
- **EXIF rotation is applied first**: a photo that only looks upright because of an orientation tag is rotated for real before re-encoding, so the result is upright in every viewer, including the ones that ignore EXIF.
- **ZIP of the whole batch**: download every result in one file, or download single images one by one.
- **Română, English, Srpski (Latin), Српски (Cyrillic)** - the language can be changed from the header and is remembered. A `?lang=ro`, `?lang=en`, `?lang=sr-Latn` or `?lang=sr-Cyrl` parameter overrides the stored choice for that visit, which is what the sitemap and the `hreflang` links use.
- **Light and dark theme**, keyboard navigation, visible focus, screen-reader labels, reduced-motion and high-contrast friendly styles.
- **Works offline** after the first visit: an installable PWA with an offline app shell, so a batch keeps working on a plane or in a basement.

## What happens to the metadata

The original file is read but never uploaded and never modified. The compressed file is written by drawing the decoded image onto a canvas and encoding that canvas again, which means the output contains **no EXIF, no IPTC, no XMP, no GPS, no thumbnail, no comment and no maker note**. For JPEG sources, the app also reads the EXIF orientation tag first and bakes that rotation into the pixels; tags 2 to 8 are all handled. The panel next to the comparison states what was detected and that the output is clean.

If you want to confirm it yourself: pick a photo with GPS data, compress it, then run `exiftool` on both files. The original will list the coordinates, the result will list nothing but its own dimensions and the tool version.

## How the compression works, and where its limits are

The pipeline is: `File` → `createImageBitmap` → optional resize → canvas → `toBlob` with the chosen quality. That is the browser's own encoder, and it is a genuinely good one - but it is not mozjpeg and it is not a WASM build of Squoosh, so at the same visual quality those tools will usually produce a slightly smaller file. This app chooses speed, offline reliability and a 100 KB page over a 1-3 MB WASM bundle. What it does guarantee is that the numbers it reports are the real byte sizes of the files you get.

Honest limitations, stated up front:

- **Recompression can grow a file.** If an image was already compressed hard (a 320x240 thumbnail saved at quality 55, for example), re-encoding it at quality 78 produces a bigger file. The app says so per file with a "bigger" badge instead of hiding it.
- **PNG has no quality knob.** For PNG output the quality slider is disabled and noted in the interface: resizing still works, quality does not apply.
- **Transparency and JPEG.** Choosing JPEG for an image with an alpha channel flattens transparency onto white, which is what most people expect; if you need the transparency, use PNG or WebP.
- **HEIC/HEIF** is readable only where the browser itself can decode it, which in practice means Safari on Apple platforms. On other browsers the file is reported as unreadable, with a retry button, rather than silently skipped.
- **No AVIF writing.** Browsers expose an AVIF encoder inconsistently, so it is not offered. AVIF files that the browser can decode can still be loaded and converted.
- **GIF is treated as a still image.** Only the first frame is compressed, and each such row carries a warning badge. Animated output is not attempted.
- The quality slider and the canvas encoder are the browser's; results differ slightly between Chrome, Firefox and Safari.

## Formats

| Input | Read | Notes |
|---|---|---|
| JPEG / JPG | Yes | EXIF orientation applied, all metadata stripped |
| PNG | Yes | Alpha preserved when output is PNG or WebP |
| WebP | Yes | Re-encoded to WebP or converted |
| GIF | Yes | First frame only, warning shown per file |
| BMP | Yes | Converted to the chosen output format |
| AVIF | If the browser decodes it | Re-encoded to JPEG, WebP or PNG |
| HEIC / HEIF | Safari/Apple platforms only | Otherwise reported as unreadable |

| Output | Notes |
|---|---|
| Keep source format | Default. HEIC sources become JPEG, GIF becomes a still image |
| JPEG | Smallest for photographs, no transparency |
| WebP | Smallest overall where supported, transparency kept |
| PNG | Lossless-ish, best for screenshots and flat graphics |

## The ZIP download

"Download all" writes a ZIP in the browser. It is built in this project as a **store-only** archive: local file headers, CRC-32 checksums, UTF-8 filenames, a central directory and an end-of-central-directory record. Nothing is deflated, because the members are already-compressed images and deflate would only add time. It opens in Windows Explorer, macOS Finder, `unzip`, 7-Zip and GNOME Archive Manager; duplicate filenames get a `-2` suffix instead of overwriting each other. A safety guard stops the build if the batch would produce an archive over 300 MB.

## Keyboard

| Key | Action |
|---|---|
| `Space` | Start processing (only when there is something to process) |
| `1` / `2` | Switch between the Compress and About tabs |
| `Ctrl+V` | Add an image from the clipboard |
| `Esc` | Close the confirmation dialog |

## Privacy

- **No uploads.** The page contains no `fetch`, no `XMLHttpRequest`, no `WebSocket`, no beacon and no external `src` of any kind. You can confirm it in DevTools: open the Network panel, clear it, compress twenty images, and watch it stay empty. The only requests ever made are for the app's own files on first load.
- **No analytics, no cookies, no fonts from a CDN, no third-party code at all.** See [NOTICE](NOTICE).
- **Settings stay on your device** in `localStorage` under `image_compressor_settings_v1` (quality, maximum width, format, theme, language), and the About tab has a reset button for them. If the browser blocks local storage, the app keeps working and says that settings will only last for the session.
- **Original files are never touched.** The app only reads what you hand it and hands you new files back.

## Run it locally

Download the repository and open `index.html` directly - decoding, compression and ZIP download all work from `file://`. The service worker (offline mode) needs a real origin, so for that:

```bash
python3 -m http.server 8080
# then open http://localhost:8080/
```

## Build it from source

The shipped `index.html` is generated from `src/` by a small deterministic script - the same inputs always produce the same bytes, so the published file can be rebuilt and compared:

```bash
python3 build.py --out .
```

`build.py` inlines `src/styles.css`, `src/i18n.js` and `src/app.js` into `src/template.html`, checks that all four locales carry exactly the same keys with the same placeholders, refuses to write an output containing an em dash or a BOM, and prints the SHA-256 of the result.

## Project layout

```
index.html                  the whole application, one file, ~100 KB
manifest.json               PWA manifest (icons, shortcuts, screenshots)
sw.js                       service worker: offline app shell
build.py                    deterministic build script (src/ -> index.html)
src/template.html           page structure, metadata, dialog, toast
src/styles.css              theme system, light and dark
src/i18n.js                 all four locales, identical key sets
src/app.js                  decode, resize, encode, EXIF, ZIP, UI logic
icon-*.png, apple-touch-icon.png, favicon.ico, og-image.png
screenshots/                manifest screenshots
LICENSE, NOTICE             Apache-2.0, third-party statement (there is none)
```

## Verification

Before release the app was exercised in a real browser with an automated suite: metadata really gone from the output (checked by parsing the produced bytes), orientation applied for all eight tags, resize never enlarging, quality 40% producing a smaller file than 90%, reported savings equal to the measured byte difference, a 25-image batch completing, cancel leaving no half-written rows, the ZIP opening with `unzip -t` and every member readable, zero network requests during a full run, the page working offline after a reload, and zero axe-core accessibility violations in all four languages and both themes.

The bundle sizes in the interface are the actual `Blob.size` values, so the savings are not estimates.

## License and credits

Apache-2.0. Copyright 2026 Kristian Mario Miskovic (TekiDeki). The application bundles no third-party code; if that ever changes, the extra notice goes into [NOTICE](NOTICE).

## Support

If this saves you time, you can leave a coffee at [paypal.me/TekiDeki](https://paypal.me/TekiDeki) - in the app, the button under the About tab does the same thing. Everything works fully without it.
