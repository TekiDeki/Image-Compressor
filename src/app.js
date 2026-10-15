/* Image Compressor · TekiDeki - application logic (no third-party code)
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Kristian Mario Miskovic (TekiDeki)
 *
 * Pipeline: File API -> createImageBitmap (with an EXIF orientation matrix we
 * control) -> canvas -> toBlob -> Blob download or a store-only ZIP written here.
 * Nothing ever leaves the page.
 */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  function el(tag, options) {
    const node = document.createElement(tag);
    const opts = options || {};
    if (opts.class) node.className = opts.class;
    if (opts.text !== undefined) node.textContent = opts.text;
    if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
    if (opts.on) for (const [k, v] of Object.entries(opts.on)) node.addEventListener(k, v);
    return node;
  }

  // ---------- i18n ----------
  let currentLang = 'ro';
  function t(key, vars) {
    const table = (typeof I18N !== 'undefined' && I18N[currentLang]) || {};
    const fallback = (typeof I18N !== 'undefined' && I18N.en) || {};
    let text = table[key] !== undefined ? table[key] : (fallback[key] !== undefined ? fallback[key] : key);
    if (vars) {
      for (const [k, v] of Object.entries(vars)) text = text.split('{' + k + '}').join(String(v));
    }
    return text;
  }
  const locale = () => LOCALES[currentLang] || 'en-GB';
  const fmtCount = n => new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(Number(n) || 0);
  function fmtBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return fmtCount(value) + ' B';
    if (value < 1024 * 1024) return fmtCount(Math.round(value / 1024)) + ' KB';
    return fmtCount(Math.round(value / (1024 * 1024) * 10) / 10) + ' MB';
  }
  const fmtPercent = n => new Intl.NumberFormat(locale(), { maximumFractionDigits: 0 }).format(n) + '%';

  // ---------- storage (works, memory-only, or unreadable) ----------
  const KEYS = { settings: 'image_compressor_settings_v1' };
  const DEFAULT_SETTINGS = { quality: 78, maxWidth: 1600, format: 'auto', dark: null, lang: null };
  const memory = {};
  let storageWorks = true;
  let dataState = 'ok';                      // ok | memory | unreadable
  try {
    localStorage.setItem('__img_probe__', '1');
    localStorage.removeItem('__img_probe__');
  } catch (e) { storageWorks = false; }
  function storeGet(key) {
    if (!storageWorks) return memory[key] !== undefined ? memory[key] : null;
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function storeSet(key, value) {
    if (!storageWorks) { memory[key] = value; dataState = 'memory'; return false; }
    try { localStorage.setItem(key, value); return true; } catch (e) { memory[key] = value; dataState = 'memory'; return false; }
  }
  let settings = Object.assign({}, DEFAULT_SETTINGS);
  function loadSettings() {
    const raw = storeGet(KEYS.settings);
    if (raw === null || raw === '') { dataState = storageWorks ? 'ok' : 'memory'; return; }
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { dataState = 'unreadable'; return; }
    const quality = Number(parsed.quality);
    const maxWidth = Number(parsed.maxWidth);
    settings = {
      quality: Number.isFinite(quality) ? Math.min(95, Math.max(40, Math.round(quality))) : DEFAULT_SETTINGS.quality,
      maxWidth: Number.isFinite(maxWidth) && maxWidth >= 0 ? Math.min(8000, Math.round(maxWidth)) : DEFAULT_SETTINGS.maxWidth,
      format: ['auto', 'jpeg', 'webp', 'png'].includes(parsed.format) ? parsed.format : 'auto',
      dark: typeof parsed.dark === 'boolean' ? parsed.dark : null,
      lang: I18N[parsed.lang] ? parsed.lang : null,
    };
    dataState = storageWorks ? 'ok' : 'memory';
  }
  function saveSettings() {
    let ok = storeSet(KEYS.settings, JSON.stringify(settings));
    if (ok) dataState = 'ok';
    refreshBanner();
  }

  // ---------- capabilities ----------
  const WEBP_SUPPORTED = (function () {
    try {
      const probe = document.createElement('canvas');
      probe.width = probe.height = 1;
      return probe.toDataURL('image/webp').indexOf('data:image/webp') === 0;
    } catch (e) { return false; }
  })();

  // ---------- EXIF (only what we display and act on) ----------
  const EXIF_TAG_ORIENTATION = 0x0112;
  const EXIF_TAG_MAKE = 0x010f;
  const EXIF_TAG_MODEL = 0x0110;
  const EXIF_TAG_EXIF_IFD = 0x8769;
  const EXIF_TAG_DATETIME_ORIGINAL = 0x9003;
  const EXIF_TAG_GPS_IFD = 0x8825;

  /* An 8x4 JPEG tagged with orientation 6, kept here as base64. Decoding it
   * shows whether this browser hands out already-rotated pixels (most do) or
   * raw ones, so the orientation transform is applied exactly once. */
  const ORIENTATION_PROBE_B64 = '/9j/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAAEAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDMooorkPoD/9k=';
  let platformUpright = null;
  function probeImage() {
    const binary = atob(ORIENTATION_PROBE_B64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: 'image/jpeg' });
  }
  async function platformAppliesOrientation() {
    if (platformUpright !== null) return platformUpright;
    platformUpright = false;
    if (typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(probeImage());
        platformUpright = bitmap.height > bitmap.width;
        if (bitmap.close) bitmap.close();
      } catch (e) { platformUpright = false; }
    }
    return platformUpright;
  }

  /* Reads the EXIF block and the stored pixel size of a JPEG. The stored size
   * matters because it is the only way to tell whether a decoder already
   * rotated the pixels before we saw them. */
  async function readJpegInfo(file) {
    const looksJpeg = /^image\/jpe?g$/i.test(file.type || '') || /\.jpe?g$/i.test(file.name || '');
    if (!looksJpeg) return null;
    let buffer;
    try { buffer = await file.slice(0, 262144).arrayBuffer(); } catch (e) { return null; }
    const view = new DataView(buffer);
    if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) return null;
    const info = { hasExif: false, orientation: 1, make: '', model: '', dateTime: '', gps: false, storedWidth: 0, storedHeight: 0 };
    let offset = 2;
    while (offset + 4 < view.byteLength) {
      if (view.getUint8(offset) !== 0xff) { offset++; continue; }
      const marker = view.getUint8(offset + 1);
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
      if (marker === 0xda) break;                                    // image data starts here
      const size = view.getUint16(offset + 2, false);
      if (size < 2) break;
      if (marker === 0xe1 && !info.hasExif) {
        const start = offset + 4;
        if (start + 6 <= view.byteLength && view.getUint32(start, false) === 0x45786966) {
          const parsed = parseTiff(view, start + 6);
          if (parsed) Object.assign(info, parsed, { hasExif: true });
        }
      }
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof && offset + 9 <= view.byteLength) {
        info.storedHeight = view.getUint16(offset + 5, false);
        info.storedWidth = view.getUint16(offset + 7, false);
      }
      offset += 2 + size;
    }
    return info;
  }

  function parseTiff(view, base) {
    if (base + 8 > view.byteLength) return null;
    const endian = view.getUint16(base, false);
    const little = endian === 0x4949;
    if (!little && endian !== 0x4d4d) return null;
    const readU16 = offset => view.getUint16(offset, little);
    const readU32 = offset => view.getUint32(offset, little);
    if (readU16(base + 2) !== 0x002a) return null;
    const ifd0 = base + readU32(base + 4);
    const out = { orientation: 1, make: '', model: '', dateTime: '', gps: false };
    const readIfd = (ifdOffset, wanted) => {
      if (ifdOffset + 2 > view.byteLength) return {};
      const count = readU16(ifdOffset);
      const values = {};
      for (let i = 0; i < count; i++) {
        const entry = ifdOffset + 2 + i * 12;
        if (entry + 12 > view.byteLength) break;
        const tag = readU16(entry);
        if (!wanted.includes(tag)) continue;
        const type = readU16(entry + 2);
        const num = readU32(entry + 4);
        const valueOffset = entry + 8;
        if (type === 3) {                                     // SHORT
          values[tag] = readU16(valueOffset);
        } else if (type === 2) {                              // ASCII
          const size = num;
          const strOffset = size > 4 ? base + readU32(valueOffset) : valueOffset;
          if (strOffset + size <= view.byteLength) {
            let text = '';
            for (let c = 0; c < size && view.getUint8(strOffset + c) !== 0; c++) text += String.fromCharCode(view.getUint8(strOffset + c));
            values[tag] = text.trim();
          }
        } else if (type === 4) {                              // LONG, a pointer
          values[tag] = readU32(valueOffset);
        }
      }
      return values;
    };
    const ifd0Values = readIfd(ifd0, [EXIF_TAG_ORIENTATION, EXIF_TAG_MAKE, EXIF_TAG_MODEL, EXIF_TAG_EXIF_IFD, EXIF_TAG_GPS_IFD]);
    if (ifd0Values[EXIF_TAG_ORIENTATION]) out.orientation = ifd0Values[EXIF_TAG_ORIENTATION];
    if (ifd0Values[EXIF_TAG_MAKE]) out.make = ifd0Values[EXIF_TAG_MAKE];
    if (ifd0Values[EXIF_TAG_MODEL]) out.model = ifd0Values[EXIF_TAG_MODEL];
    if (ifd0Values[EXIF_TAG_GPS_IFD]) out.gps = true;
    if (ifd0Values[EXIF_TAG_EXIF_IFD]) {
      const exifValues = readIfd(base + ifd0Values[EXIF_TAG_EXIF_IFD], [EXIF_TAG_DATETIME_ORIGINAL]);
      if (exifValues[EXIF_TAG_DATETIME_ORIGINAL]) out.dateTime = exifValues[EXIF_TAG_DATETIME_ORIGINAL];
    }
    return out;
  }

  /* Decides whether the pixels we hold still need the EXIF rotation. When the
   * stored size is known it is compared with the decoded size, which answers
   * the question directly; for square images and unknown sources the platform
   * probe is the only signal available. */
  function effectiveOrientation(orientation, width, height, info, sourceUpright) {
    if (!orientation || orientation < 2) return 1;
    if (info && info.storedWidth && info.storedHeight) {
      const same = width === info.storedWidth && height === info.storedHeight;
      const swapped = width === info.storedHeight && height === info.storedWidth;
      if (same !== swapped) return same ? orientation : 1;
    }
    return sourceUpright ? 1 : orientation;
  }

  // ---------- decode / draw / encode ----------
  async function loadBitmap(file) {
    if (typeof createImageBitmap === 'function') {
      const upright = await platformAppliesOrientation();
      try {
        const bitmap = await createImageBitmap(file);
        return { source: bitmap, width: bitmap.width, height: bitmap.height, upright, close: () => bitmap.close && bitmap.close() };
      } catch (e) { /* fall through to the <img> path */ }
    }
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({
        source: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        upright: true,                                   // <img> decoders rotate EXIF images themselves
        close: () => URL.revokeObjectURL(url),
      });
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }

  const orientedDims = (width, height, orientation) => (orientation >= 5 && orientation <= 8) ? [height, width] : [width, height];

  /* Builds the draw matrix for one EXIF orientation, already scaled by s.
   * Everything is expressed in source pixels so the result lands exactly inside
   * a canvas of outW x outH (see the table in the README notes). */
  function orientationMatrix(orientation, s, sw, sh) {
    switch (orientation) {
      case 2: return [-s, 0, 0, s, s * sw, 0];
      case 3: return [-s, 0, 0, -s, s * sw, s * sh];
      case 4: return [s, 0, 0, -s, 0, s * sh];
      case 5: return [0, s, s, 0, 0, 0];
      case 6: return [0, s, -s, 0, s * sh, 0];
      case 7: return [0, -s, -s, 0, s * sh, s * sw];
      case 8: return [0, -s, s, 0, 0, s * sw];
      default: return [s, 0, 0, s, 0, 0];
    }
  }

  function toBlob(canvas, mime, quality) {
    return new Promise(resolve => {
      try {
        canvas.toBlob(blob => resolve(blob || null), mime, quality);
      } catch (e) { resolve(null); }
    });
  }

  const MIME = { jpeg: 'image/jpeg', webp: 'image/webp', png: 'image/png' };
  const FORMAT_LABEL = { jpeg: 'JPEG', webp: 'WebP', png: 'PNG' };
  const EXT = { jpeg: 'jpg', webp: 'webp', png: 'png' };

  function resolvedFormat(file) {
    if (settings.format !== 'auto') {
      if (settings.format === 'webp' && !WEBP_SUPPORTED) return 'jpeg';
      return settings.format;
    }
    const type = (file.type || '').toLowerCase();
    if (type === 'image/png') return 'png';
    if (type === 'image/webp' && WEBP_SUPPORTED) return 'webp';
    return 'jpeg';
  }
  function outputName(name, ext) {
    const base = String(name || 'image').replace(/\.[^./\\]+$/, '');
    return base + '-compact.' + ext;
  }

  // ---------- state ----------
  const MAX_FILES = 60;
  const MAX_FILE_BYTES = 40 * 1024 * 1024;
  const ZIP_MAX_BYTES = 300 * 1024 * 1024;
  let items = [];
  let processing = false;
  let cancelRequested = false;
  let stale = false;
  let selectedId = null;
  let previewOriginalUrl = null;
  let itemSeq = 0;

  const itemById = id => items.find(item => item.id === id);
  const doneItems = () => items.filter(item => item.status === 'done' && item.outBlob);

  // ---------- list handling ----------
  function addFiles(fileList) {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    let limitHit = false;
    let queued = 0;
    for (const file of incoming) {
      if (items.length >= MAX_FILES) { limitHit = true; break; }
      const id = ++itemSeq;
      const name = file.name || ('image-' + id);
      const item = {
        id, file, name, size: file.size, status: 'pending', retryable: true,
        outBlob: null, outUrl: null, outSize: 0, outWidth: 0, outHeight: 0, displayW: 0, displayH: 0,
        outName: '', meta: null, error: '',
        gif: (file.type || '').toLowerCase() === 'image/gif' || /\.gif$/i.test(name),
      };
      const imageType = /^image\//i.test(file.type || '');
      if (!imageType && !/\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i.test(name)) {
        item.status = 'error';
        item.retryable = false;
        item.error = t('error_unsupported', { name });
      } else if (file.size > MAX_FILE_BYTES) {
        item.status = 'error';
        item.retryable = false;
        item.error = t('file_too_large', { name, max: fmtBytes(MAX_FILE_BYTES) });
      } else {
        queued++;
      }
      items.push(item);
    }
    const note = $('fileNote');
    if (limitHit) {
      note.textContent = t('files_limit', { max: fmtCount(MAX_FILES) });
      note.hidden = false;
    } else if (queued > 0) {
      note.textContent = t('files_selected', { n: fmtCount(queued) });
      note.hidden = false;
    }
    renderList();
    refreshControls();
  }

  function removeItem(id) {
    const item = itemById(id);
    if (!item) return;
    if (item.outUrl) URL.revokeObjectURL(item.outUrl);
    items = items.filter(entry => entry.id !== id);
    if (selectedId === id) {
      selectedId = null;
      $('previewCard').hidden = true;
      if (previewOriginalUrl) { URL.revokeObjectURL(previewOriginalUrl); previewOriginalUrl = null; }
    }
    renderList();
    refreshControls();
    updateSummary();
  }

  function clearAll() {
    for (const item of items) if (item.outUrl) URL.revokeObjectURL(item.outUrl);
    items = [];
    selectedId = null;
    stale = false;
    if (previewOriginalUrl) { URL.revokeObjectURL(previewOriginalUrl); previewOriginalUrl = null; }
    $('previewCard').hidden = true;
    $('fileNote').hidden = true;
    $('staleNote').hidden = true;
    renderList();
    refreshControls();
    updateSummary();
    toast(t('toast_cleared'));
  }

  function statusBadge(item) {
    const map = {
      pending: ['badge', 'status_pending'],
      working: ['badge badge-info', 'status_working'],
      done: ['badge badge-pos', 'status_done'],
      error: ['badge badge-danger', 'status_error'],
      cancelled: ['badge badge-warn', 'status_cancelled'],
    };
    const [cls, key] = map[item.status] || map.pending;
    return el('span', { class: cls, text: t(key) });
  }

  function renderList() {
    const list = $('fileList');
    list.textContent = '';
    const count = $('listCount');
    count.textContent = t('list_count', { n: fmtCount(items.length) });
    count.hidden = items.length === 0;
    $('listEmpty').hidden = items.length > 0;
    $('listEmptyHint').hidden = items.length > 0;
    $('staleNote').hidden = !(stale && doneItems().length);
    for (const item of items) {
      const row = el('li', { class: 'list-item' + (item.id === selectedId ? ' is-selected' : '') });
      const main = el('div', { class: 'list-main' });
      main.appendChild(el('div', { class: 'list-name', text: item.outName || item.name }));
      const meta = el('div', { class: 'list-meta' });
      meta.appendChild(statusBadge(item));
      if (item.status === 'done') {
        meta.appendChild(el('span', { class: 'small muted', text: fmtBytes(item.size) + ' -> ' + fmtBytes(item.outSize) }));
        const pct = item.size > 0 ? Math.round((1 - item.outSize / item.size) * 100) : 0;
        if (pct > 0) meta.appendChild(el('span', { class: 'badge badge-pos', text: t('saving_badge', { p: fmtCount(pct) }) }));
        else meta.appendChild(el('span', { class: 'badge badge-warn', text: t('bigger_warning') }));
        if (item.outWidth) meta.appendChild(el('span', { class: 'small muted', text: item.outWidth + ' x ' + item.outHeight + ' px' }));
        if (item.format) meta.appendChild(el('span', { class: 'small muted', text: FORMAT_LABEL[item.format] || item.format }));
      } else if (item.status === 'error') {
        meta.appendChild(el('span', { class: 'small', text: item.error }));
      }
      if (item.gif) meta.appendChild(el('span', { class: 'badge badge-warn', text: t('gif_note') }));
      main.appendChild(meta);
      row.appendChild(main);

      const actions = el('div', { class: 'list-actions' });
      if (item.status === 'done') {
        actions.appendChild(el('button', {
          class: 'btn-ghost btn-sm', text: t('preview_show'), attrs: { type: 'button', 'data-action': 'preview', 'data-id': item.id, 'aria-label': t('preview_show') + ': ' + item.name },
        }));
        actions.appendChild(el('button', {
          class: 'btn-primary btn-sm', text: t('download_one'), attrs: { type: 'button', 'data-action': 'download', 'data-id': item.id, 'aria-label': t('download_one') + ': ' + item.outName },
        }));
      } else if (item.status === 'error' && item.retryable !== false) {
        actions.appendChild(el('button', {
          class: 'btn-ghost btn-sm', text: t('retry_one'), attrs: { type: 'button', 'data-action': 'retry', 'data-id': item.id, 'aria-label': t('retry_one') + ': ' + item.name },
        }));
      }
      actions.appendChild(el('button', {
        class: 'btn-ghost btn-sm', text: t('remove_one'), attrs: { type: 'button', 'data-action': 'remove', 'data-id': item.id, 'aria-label': t('remove_one') + ': ' + item.name },
      }));
      row.appendChild(actions);
      list.appendChild(row);
    }
  }

  function updateSummary() {
    const summary = $('summary');
    const done = doneItems();
    if (!done.length) { summary.hidden = true; return; }
    const before = done.reduce((sum, item) => sum + item.size, 0);
    const after = done.reduce((sum, item) => sum + item.outSize, 0);
    const saved = before > 0 ? Math.round((1 - after / before) * 100) : 0;
    $('totalFiles').textContent = done.length + ' / ' + items.length;
    $('totalBefore').textContent = fmtBytes(before);
    $('totalAfter').textContent = fmtBytes(after);
    const badge = $('totalSaved');
    badge.className = 'badge ' + (saved >= 0 ? 'badge-pos' : 'badge-warn');
    badge.textContent = t('saving_badge', { p: fmtCount(saved) });
    summary.hidden = false;
  }

  function refreshControls() {
    const hasItems = items.length > 0;
    const done = doneItems();
    const runnable = items.some(item => item.status === 'pending' || (item.status === 'error' && item.retryable !== false) || (stale && item.status === 'done'));
    $('processBtn').disabled = processing || !runnable;
    $('cancelBtn').hidden = !processing;
    $('downloadAllBtn').disabled = processing || done.length === 0;
    $('clearListBtn').disabled = processing || !hasItems;
  }

  function setProgress(done, total) {
    const wrap = $('progressWrap');
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    wrap.hidden = total === 0;
    wrap.setAttribute('aria-valuenow', String(percent));
    $('progressBar').style.width = percent + '%';
    const text = $('progressText');
    text.hidden = total === 0;
    text.textContent = t('process_running', { done: fmtCount(done), total: fmtCount(total) });
    $('progressLive').textContent = t('process_running', { done: fmtCount(done), total: fmtCount(total) });
  }

  // ---------- processing ----------
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));

  async function processItem(item) {
    item.status = 'working';
    item.error = '';
    renderList();
    try {
      const decoded = await loadBitmap(item.file);
      const meta = await readJpegInfo(item.file);
      item.meta = meta;
      const orientation = meta && meta.orientation ? meta.orientation : 1;
      const rotation = effectiveOrientation(orientation, decoded.width, decoded.height, meta, decoded.upright);
      const [displayW, displayH] = orientedDims(decoded.width, decoded.height, rotation);
      const scale = settings.maxWidth > 0 ? Math.min(1, settings.maxWidth / displayW) : 1;
      const outW = Math.max(1, Math.round(displayW * scale));
      const outH = Math.max(1, Math.round(displayH * scale));
      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      const format = resolvedFormat(item.file);
      if (format === 'jpeg') {                        // transparency becomes white, not black
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, outW, outH);
      }
      const matrix = orientationMatrix(rotation, scale, decoded.width, decoded.height);
      ctx.setTransform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(decoded.source, 0, 0);
      if (decoded.close) decoded.close();
      const blob = await toBlob(canvas, MIME[format], settings.quality / 100);
      canvas.width = canvas.height = 0;
      if (!blob) throw new Error('encode');
      if (item.outUrl) URL.revokeObjectURL(item.outUrl);
      item.outBlob = blob;
      item.outSize = blob.size;
      item.outWidth = outW;
      item.outHeight = outH;
      item.displayW = displayW;
      item.displayH = displayH;
      item.outName = outputName(item.name, EXT[format]);
      item.format = format;
      item.status = 'done';
      return null;
    } catch (error) {
      item.status = 'error';
      const decoded = /decode/i.test(String(error && error.message));
      const unsupported = /unsupported|not supported|heif|heic/i.test(String(error && error.message));
      item.error = (unsupported || decoded) ? t('error_decode', { name: item.name }) : t('error_encode', { name: item.name });
      return item.error;
    }
  }

  async function processAll() {
    if (processing) return;
    const queue = items.filter(item => item.status === 'pending' || (item.status === 'error' && item.retryable !== false) || (stale && item.status === 'done'));
    if (!queue.length) return;
    processing = true;
    cancelRequested = false;
    const wasStale = stale;
    stale = false;
    $('staleNote').hidden = true;
    refreshControls();
    let done = 0;
    setProgress(0, queue.length);
    for (const item of queue) {
      if (cancelRequested) {
        if (item.status === 'working') item.status = 'pending';
        break;
      }
      await processItem(item);
      done++;
      setProgress(done, queue.length);
      renderList();
      updateSummary();
      await tick();
    }
    processing = false;
    const cancelled = cancelRequested;
    cancelRequested = false;
    if (cancelled) {
      for (const item of items) if (item.status === 'working') item.status = 'pending';
      toast(t('process_cancelled'));
      setProgress(0, 0);
    } else {
      toast(t('process_done', { n: fmtCount(done) }));
      setProgress(items.length, items.length);
      if (wasStale) renderList();
    }
    renderList();
    refreshControls();
    updateSummary();
  }

  // ---------- downloads ----------
  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function downloadOne(id) {
    const item = itemById(id);
    if (!item || !item.outBlob) return;
    triggerDownload(item.outBlob, item.outName || item.name);
    toast(t('toast_downloaded'));
  }

  // --- a store-only ZIP (CRC32, no compression, no dependency) ---
  let crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        crcTable[n] = c >>> 0;
      }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date) {
    const time = ((date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)) & 0xffff;
    const day = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
    return { time, day };
  }

  function buildZip(entries) {
    const encoder = new TextEncoder();
    const stamp = dosDateTime(new Date());
    const chunks = [];
    const central = [];
    let offset = 0;
    for (const entry of entries) {
      const nameBytes = encoder.encode(entry.name);
      const data = new Uint8Array(entry.bytes);
      const crc = crc32(data);
      const header = new DataView(new ArrayBuffer(30));
      header.setUint32(0, 0x04034b50, true);
      header.setUint16(4, 20, true);
      header.setUint16(6, 0x0800, true);              // UTF-8 names
      header.setUint16(8, 0, true);                   // method 0 = stored
      header.setUint16(10, stamp.time, true);
      header.setUint16(12, stamp.day, true);
      header.setUint32(14, crc, true);
      header.setUint32(18, data.length, true);
      header.setUint32(22, data.length, true);
      header.setUint16(26, nameBytes.length, true);
      header.setUint16(28, 0, true);
      chunks.push(new Uint8Array(header.buffer), nameBytes, data);
      const centralHeader = new DataView(new ArrayBuffer(46));
      centralHeader.setUint32(0, 0x02014b50, true);
      centralHeader.setUint16(4, 20, true);
      centralHeader.setUint16(6, 20, true);
      centralHeader.setUint16(8, 0x0800, true);
      centralHeader.setUint16(10, 0, true);
      centralHeader.setUint16(12, stamp.time, true);
      centralHeader.setUint16(14, stamp.day, true);
      centralHeader.setUint32(16, crc, true);
      centralHeader.setUint32(20, data.length, true);
      centralHeader.setUint32(24, data.length, true);
      centralHeader.setUint16(28, nameBytes.length, true);
      centralHeader.setUint32(42, offset, true);
      central.push(new Uint8Array(centralHeader.buffer), nameBytes);
      offset += 30 + nameBytes.length + data.length;
    }
    const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, entries.length, true);
    end.setUint16(10, entries.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    return new Blob(chunks.concat(central, [new Uint8Array(end.buffer)]), { type: 'application/zip' });
  }

  async function downloadAllZip() {
    const done = doneItems();
    if (!done.length) { toast(t('nothing_to_download')); return; }
    const totalBytes = done.reduce((sum, item) => sum + item.outSize, 0);
    if (totalBytes > ZIP_MAX_BYTES) {
      toast(t('zip_too_large', { size: fmtBytes(totalBytes), max: fmtBytes(ZIP_MAX_BYTES) }));
      return;
    }
    const used = new Set();
    const entries = [];
    for (const item of done) {
      let name = item.outName || outputName(item.name, 'jpg');
      if (used.has(name)) {
        const dot = name.lastIndexOf('.');
        const base = dot > 0 ? name.slice(0, dot) : name;
        const ext = dot > 0 ? name.slice(dot) : '';
        let counter = 2;
        while (used.has(base + '-' + counter + ext)) counter++;
        name = base + '-' + counter + ext;
      }
      used.add(name);
      entries.push({ name, bytes: await item.outBlob.arrayBuffer() });
    }
    const zip = buildZip(entries);
    triggerDownload(zip, 'compressed-images-' + new Date().toISOString().slice(0, 10) + '.zip');
    toast(t('zip_ready', { n: fmtCount(entries.length) }));
  }

  // ---------- preview ----------
  function metaSummary(meta) {
    if (!meta || !meta.hasExif) return [t('meta_none')];
    const found = [];
    if (meta.make || meta.model) found.push(t('meta_device') + (meta.model ? ' (' + meta.model + ')' : ''));
    if (meta.dateTime) found.push(t('meta_date') + ' (' + meta.dateTime + ')');
    if (meta.gps) found.push(t('meta_gps'));
    if (meta.orientation && meta.orientation > 1) found.push(t('meta_orientation', { n: meta.orientation }));
    return found.length ? [t('meta_found', { list: found.join(', ') })] : [t('meta_none')];
  }

  function showPreview(id) {
    const item = itemById(id);
    if (!item || item.status !== 'done' || !item.outBlob) return;
    selectedId = id;
    if (previewOriginalUrl) { URL.revokeObjectURL(previewOriginalUrl); previewOriginalUrl = null; }
    previewOriginalUrl = URL.createObjectURL(item.file);
    if (item.outUrl) URL.revokeObjectURL(item.outUrl);
    item.outUrl = URL.createObjectURL(item.outBlob);
    $('previewOriginal').src = previewOriginalUrl;
    $('previewCompressed').src = item.outUrl;
    const displayW = item.displayW || item.outWidth;
    const displayH = item.displayH || item.outHeight;
    $('previewOriginalCaption').textContent = t('preview_caption', { dims: displayW + ' x ' + displayH + ' px', size: fmtBytes(item.size) });
    $('previewCompressedCaption').textContent = t('preview_caption', { dims: item.outWidth + ' x ' + item.outHeight + ' px', size: fmtBytes(item.outSize) });
    const meta = $('previewMeta');
    meta.textContent = '';
    for (const line of metaSummary(item.meta)) meta.appendChild(el('li', { text: line }));
    meta.appendChild(el('li', { class: 'small muted', text: t('meta_cleaned') }));
    $('previewCard').hidden = false;
    renderList();
  }

  // ---------- banner / toast / dialog ----------
  let bannerActions = [];
  function setBanner(kind, text, actions) {
    const banner = $('statusBanner');
    if (!text) { banner.hidden = true; $('statusText').textContent = ''; $('statusActions').textContent = ''; bannerActions = []; return; }
    banner.className = 'status-banner' + (kind ? ' ' + kind : '');
    $('statusText').textContent = text;
    $('statusActions').textContent = '';
    bannerActions = actions || [];
    bannerActions.forEach((action, index) => {
      $('statusActions').appendChild(el('button', {
        class: index === 0 ? 'btn-primary btn-sm' : 'btn-ghost btn-sm',
        text: action.label, attrs: { type: 'button', 'data-banner-action': String(index) },
      }));
    });
    banner.hidden = false;
  }
  function refreshBanner() {
    if (dataState === 'memory') { setBanner('info', t('banner_memory'), []); return; }
    if (dataState === 'unreadable') { setBanner('warn', t('banner_unreadable'), [{ label: t('action_reset_settings'), run: resetSettings }]); return; }
    setBanner(null, '');
  }
  let toastTimer = null;
  function toast(message) {
    const node = $('toast');
    node.textContent = message;
    node.hidden = false;
    node.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      node.classList.remove('show');
      setTimeout(() => { node.hidden = true; }, 250);
    }, 2800);
  }
  function askConfirm(title, body, confirmLabel) {
    return new Promise(resolve => {
      const dialog = $('appDialog');
      $('appDialogTitle').textContent = title;
      $('appDialogBody').textContent = body;
      $('appDialogConfirm').textContent = confirmLabel || t('confirm');
      const finish = value => {
        dialog.close();
        $('appDialogConfirm').removeEventListener('click', onConfirm);
        $('appDialogCancel').removeEventListener('click', onCancel);
        dialog.removeEventListener('cancel', onCancelEvent);
        resolve(value);
      };
      const onConfirm = () => finish(true);
      const onCancel = () => finish(false);
      const onCancelEvent = event => { event.preventDefault(); finish(false); };
      $('appDialogConfirm').addEventListener('click', onConfirm);
      $('appDialogCancel').addEventListener('click', onCancel);
      dialog.addEventListener('cancel', onCancelEvent);
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    });
  }

  // ---------- settings UI ----------
  function syncSettingsUi() {
    $('qualityRange').value = String(settings.quality);
    $('qualityOut').textContent = settings.quality + '%';
    $('widthSelect').value = String(settings.maxWidth);
    $('formatSelect').value = settings.format;
    $('pngNote').hidden = settings.format !== 'png';
    const badge = $('formatBadge');
    const labels = { auto: t('format_badge_auto'), jpeg: 'JPEG', webp: 'WebP', png: 'PNG' };
    badge.textContent = labels[settings.format] || '';
    badge.hidden = false;
    const webpOption = $('formatSelect').querySelector('option[value="webp"]');
    if (webpOption) {
      webpOption.disabled = !WEBP_SUPPORTED;
      if (!WEBP_SUPPORTED) webpOption.textContent = 'WebP (' + t('format_badge_webp_missing') + ')';
    }
  }
  function markStale() {
    if (doneItems().length) { stale = true; $('staleNote').hidden = false; }
    refreshControls();
  }
  function resetSettings() {
    settings = Object.assign({}, DEFAULT_SETTINGS);
    dataState = storageWorks ? 'ok' : 'memory';
    try { if (storageWorks) localStorage.removeItem(KEYS.settings); } catch (e) { memory[KEYS.settings] = undefined; }
    syncSettingsUi();
    applyTheme(detectDark());
    markStale();
    refreshBanner();
    toast(t('toast_settings_reset'));
  }

  // ---------- theme / language ----------
  function detectDark() {
    if (settings.dark !== null) return settings.dark;
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function applyTheme(dark) {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#0f172a' : '#f4f6f9');
    const toggle = $('themeToggle');
    toggle.textContent = dark ? '☀️' : '🌙';
    toggle.setAttribute('aria-pressed', dark ? 'true' : 'false');
    toggle.setAttribute('aria-label', t('theme_toggle'));
    toggle.title = t('theme_toggle');
  }
  function applyLanguage(lang, persist) {
    currentLang = I18N[lang] ? lang : 'en';
    if (persist) { settings.lang = currentLang; saveSettings(); }
    document.documentElement.lang = HTML_LANGS[currentLang] || currentLang;
    for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.getAttribute('data-i18n'));
    for (const node of document.querySelectorAll('[data-i18n-aria]')) node.setAttribute('aria-label', t(node.getAttribute('data-i18n-aria')));
    for (const node of document.querySelectorAll('[data-i18n-alt]')) node.setAttribute('alt', t(node.getAttribute('data-i18n-alt')));
    document.title = t('app_title') + ' - TekiDeki';
    const description = document.querySelector('meta[name="description"]');
    if (description) description.setAttribute('content', t('app_subtitle') + ' ' + t('about_metadata_text'));
    const select = $('langSelect');
    select.value = currentLang;
    select.setAttribute('aria-label', t('lang_label'));
    syncSettingsUi();
    $('progressWrap').setAttribute('aria-label', t('progress_label'));
    renderList();
    refreshControls();
    updateSummary();
    if (selectedId && itemById(selectedId)) showPreview(selectedId);
  }

  // ---------- tabs ----------
  function switchTab(name) {
    for (const button of document.querySelectorAll('[role="tab"]')) {
      const selected = button.dataset.tab === name;
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
      button.tabIndex = selected ? 0 : -1;
    }
    for (const panel of document.querySelectorAll('[role="tabpanel"]')) panel.hidden = panel.id !== 'panel-' + name;
  }

  // ---------- install ----------
  let deferredInstall = null;
  function installApp() {
    if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; $('installBtn').hidden = true; return; }
    const ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/.test(ua)) toast(t('install_ios_hint'));
    else toast(t('install_unavailable'));
  }

  // ---------- wiring ----------
  function init() {
    loadSettings();
    const params = new URLSearchParams(location.search);
    const requested = (params.get('lang') || '').toLowerCase();
    let lang = 'ro';
    if (I18N[requested]) lang = requested;
    else if (settings.lang && I18N[settings.lang]) lang = settings.lang;
    else {
      const nav = (navigator.language || 'en').toLowerCase();
      if (nav.startsWith('ro')) lang = 'ro';
      else if (nav.startsWith('sr')) lang = /cyrl|cyrillic/.test(nav) ? 'sr-cyrl' : 'sr-latn';
      else lang = 'en';
    }
    applyTheme(detectDark());
    applyLanguage(lang, false);
    syncSettingsUi();
    refreshBanner();
    renderList();
    refreshControls();
    updateSummary();

    const requestedTab = (params.get('tab') || '').toLowerCase();
    if (requestedTab === 'compress' || requestedTab === 'about') switchTab(requestedTab);

    for (const button of document.querySelectorAll('[role="tab"]')) {
      button.addEventListener('click', () => switchTab(button.dataset.tab));
    }
    const tablist = document.querySelector('[role="tablist"]');
    if (tablist) {
      tablist.addEventListener('keydown', event => {
        const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
        const index = tabs.indexOf(document.activeElement);
        if (index === -1) return;
        let next = null;
        if (event.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length];
        else if (event.key === 'ArrowLeft') next = tabs[(index - 1 + tabs.length) % tabs.length];
        else if (event.key === 'Home') next = tabs[0];
        else if (event.key === 'End') next = tabs[tabs.length - 1];
        if (next) { event.preventDefault(); switchTab(next.dataset.tab); next.focus(); }
      });
    }

    $('chooseImages').addEventListener('click', () => $('fileInput').click());
    $('fileInput').addEventListener('change', event => {
      addFiles(event.target.files);
      event.target.value = '';
    });
    const dropZone = $('dropZone');
    for (const type of ['dragenter', 'dragover']) {
      dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.add('dragover'); });
    }
    for (const type of ['dragleave', 'dragend']) {
      dropZone.addEventListener(type, () => dropZone.classList.remove('dragover'));
    }
    dropZone.addEventListener('drop', event => {
      event.preventDefault();
      dropZone.classList.remove('dragover');
      addFiles(event.dataTransfer && event.dataTransfer.files);
    });
    window.addEventListener('dragover', event => event.preventDefault());
    window.addEventListener('drop', event => event.preventDefault());
    document.addEventListener('paste', event => {
      const clipboard = event.clipboardData;
      if (!clipboard) return;
      let files = clipboard.files;
      if ((!files || !files.length) && clipboard.items) {
        const picked = [];
        for (const entry of clipboard.items) if (entry.kind === 'file') { const file = entry.getAsFile(); if (file) picked.push(file); }
        if (picked.length) files = picked;
      }
      if (files && files.length) { event.preventDefault(); addFiles(files); }
    });

    $('qualityRange').addEventListener('input', event => {
      settings.quality = Number(event.target.value);
      $('qualityOut').textContent = settings.quality + '%';
      saveSettings();
      markStale();
    });
    $('widthSelect').addEventListener('change', event => {
      settings.maxWidth = Number(event.target.value) || 0;
      saveSettings();
      syncSettingsUi();
      markStale();
    });
    $('formatSelect').addEventListener('change', event => {
      settings.format = event.target.value;
      saveSettings();
      syncSettingsUi();
      markStale();
    });
    $('processBtn').addEventListener('click', processAll);
    $('cancelBtn').addEventListener('click', () => { if (processing) { cancelRequested = true; toast(t('process_cancelled')); } });
    $('downloadAllBtn').addEventListener('click', downloadAllZip);
    $('clearListBtn').addEventListener('click', async () => {
      const confirmed = await askConfirm(t('confirm_clear_title'), t('confirm_clear_body'), t('clear_list'));
      if (confirmed) clearAll();
    });
    $('fileList').addEventListener('click', async event => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const id = Number(button.dataset.id);
      const item = itemById(id);
      if (!item) return;
      if (button.dataset.action === 'preview') showPreview(id);
      else if (button.dataset.action === 'download') downloadOne(id);
      else if (button.dataset.action === 'retry') { item.status = 'pending'; item.error = ''; renderList(); refreshControls(); processAll(); }
      else if (button.dataset.action === 'remove') {
        const confirmed = await askConfirm(t('confirm_remove_title'), t('confirm_remove_body', { name: item.name }), t('remove_one'));
        if (confirmed) removeItem(id);
      }
    });
    $('themeToggle').addEventListener('click', () => {
      settings.dark = document.documentElement.getAttribute('data-theme') !== 'dark';
      saveSettings();
      applyTheme(settings.dark);
    });
    $('langSelect').addEventListener('change', event => applyLanguage(event.target.value, true));
    $('statusActions').addEventListener('click', event => {
      const button = event.target.closest('button[data-banner-action]');
      if (!button) return;
      const action = bannerActions[Number(button.dataset.bannerAction)];
      if (action && typeof action.run === 'function') action.run();
    });
    $('resetSettings').addEventListener('click', resetSettings);
    $('installBtn').addEventListener('click', installApp);

    document.addEventListener('keydown', event => {
      const target = event.target;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
      const interactive = target && target.closest && target.closest('button, a, [role="tab"], [role="switch"], [contenteditable="true"]');
      if (typing || interactive) return;
      if (event.code === 'Space') {
        const canRun = !processing && items.some(item => item.status === 'pending' || (item.status === 'error' && item.retryable !== false) || (stale && item.status === 'done'));
        if (canRun) { event.preventDefault(); processAll(); }
      }
      else if (event.key === '1') switchTab('compress');
      else if (event.key === '2') switchTab('about');
    });

    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault();
      deferredInstall = event;
    });
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => { /* offline support is optional */ }));
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
