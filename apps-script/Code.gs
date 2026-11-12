/**
 * 토핑케이크 롤링페이퍼 — 저장공간(구글 시트) 스크립트
 *
 * script.new(새 Apps Script) 또는 구글 시트 > 확장 프로그램 > Apps Script 에
 * 이 파일 내용을 그대로 붙여 넣고, 배포 > 새 배포 > 웹 앱
 * (실행: 나 / 액세스 권한: 모든 사용자) 로 배포하세요.
 * 시트에 붙인 경우 그 시트에, script.new 로 만든 경우 내 드라이브에
 * '롤링페이퍼 저장소' 시트를 자동으로 만들어 저장합니다.
 *
 * 사진첩 사진은 내 드라이브의 '토핑케이크 사진첩 (사진 저장소)' 폴더에 저장돼요.
 * 이 코드로 처음 바꾼 뒤에는 편집기 위쪽에서 setup 함수를 골라 ▶ 실행을 한 번 눌러
 * 드라이브 사용 권한을 허용한 다음, 배포 관리 → 연필 → 새 버전으로 배포하세요.
 */
const VERSION = 3;

const HEADERS = {
  cakes:    ['code', 'to', 'title', 'flavor', 'key', 'createdAt'],
  toppings: ['id', 'cake', 'sprite', 'note', 'x', 'y', 'name', 'text', 'key', 'createdAt'],
  albums:   ['code', 'title', 'sub', 'flavor', 'cover', 'sort', 'key', 'createdAt'],
  photos:   ['id', 'album', 'fileId', 'w', 'h', 'time', 'fromExif', 'dateEdited', 'caption', 'ord', 'key', 'createdAt']
};
const MAX_PHOTOS_PER_ALBUM = 300;
const MAX_PHOTO_BASE64 = 6000000; // 사진 한 장 약 4.5MB까지
const FLAVORS = ['strawberry', 'choco', 'matcha', 'lavender'];
const SPRITES = ['strawberry', 'cherry', 'candle', 'heart', 'star', 'macaron', 'cookie', 'blueberry', 'cream', 'flower', 'choco', 'gummy'];
const NOTES = ['cream', 'berry', 'mint', 'sky', 'lav'];
const MAX_TOPPINGS_PER_CAKE = 200;
const MAX_TEXT = 600; // 편지 최대 글자 수
const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';

function doGet() {
  return out({ ok: true, data: '토핑케이크 롤링페이퍼 저장공간이 작동하고 있어요. (편지 최대 ' + MAX_TEXT + '자 · 사진첩 저장 가능 · 버전 ' + VERSION + ')' });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out({ ok: false, error: 'invalid' }); }
  const fn = ACTIONS[req.action];
  if (!fn) return out({ ok: false, error: 'invalid' });
  try {
    return out({ ok: true, data: fn(req) });
  } catch (err) {
    const code = String(err && err.message || err);
    return out({ ok: false, error: /^[a-z_]+$/.test(code) ? code : 'error' });
  }
}

const ACTIONS = {
  version() { return VERSION; },

  /* ---------- 사진첩 ---------- */
  createAlbum(req) {
    const key = str(req.key, 64), title = str(req.title, 24), sub = str(req.sub, 30);
    const flavor = FLAVORS.indexOf(req.flavor) >= 0 ? req.flavor : 'strawberry';
    if (!key) throw new Error('invalid');
    return withLock(() => {
      const used = {};
      rows('albums').forEach(r => used[r.code] = true);
      let code;
      do { code = randomCode(); } while (used[code]);
      append('albums', [code, title, sub, flavor, req.cover === false ? '0' : '1', req.sort === 'manual' ? 'manual' : 'time', key, Date.now()]);
      return code;
    });
  },

  getAlbum(req) {
    const code = str(req.code, 12), key = str(req.key, 64);
    const a = findAlbum(code);
    if (!a) throw new Error('not_found');
    const photos = rows('photos').filter(p => p.album === code).map(p => ({
      id: p.id, w: Number(p.w), h: Number(p.h), time: Number(p.time), fromExif: p.fromExif === '1', dateEdited: p.dateEdited === '1',
      caption: p.caption, ord: Number(p.ord), createdAt: Number(p.createdAt), mine: !!key && p.key === key
    }));
    return { code: a.code, title: a.title, sub: a.sub, flavor: a.flavor, cover: a.cover !== '0', sort: a.sort || 'time',
      createdAt: Number(a.createdAt), mine: !!key && a.key === key, photos: photos };
  },

  updateAlbum(req) {
    const code = str(req.code, 12), key = str(req.key, 64);
    return withLock(() => {
      const a = findAlbum(code);
      if (!a) throw new Error('not_found');
      if (!key || a.key !== key) throw new Error('forbidden');
      const ch = {};
      if (req.title != null) ch.title = str(req.title, 24);
      if (req.sub != null) ch.sub = str(req.sub, 30);
      if (req.flavor != null && FLAVORS.indexOf(req.flavor) >= 0) ch.flavor = req.flavor;
      if (req.cover != null) ch.cover = req.cover ? '1' : '0';
      if (req.sort != null) ch.sort = req.sort === 'manual' ? 'manual' : 'time';
      setCells('albums', a._row, ch);
      return true;
    });
  },

  deleteAlbum(req) {
    const code = str(req.code, 12), key = str(req.key, 64);
    return withLock(() => {
      const a = findAlbum(code);
      if (!a) throw new Error('not_found');
      if (!key || a.key !== key) throw new Error('forbidden');
      const ps = rows('photos').filter(p => p.album === code);
      ps.forEach(p => trashFile(p.fileId));
      deleteRows('photos', ps.map(p => p._row));
      deleteRows('albums', [a._row]);
      return true;
    });
  },

  addPhoto(req) {
    const code = str(req.album, 12), key = str(req.key, 64);
    const data = String(req.data || '');
    if (!key || !data || data.length > MAX_PHOTO_BASE64 || !/^[A-Za-z0-9+/=]+$/.test(data)) throw new Error('invalid');
    if (!findAlbum(code)) throw new Error('not_found');
    if (rows('photos').filter(p => p.album === code).length >= MAX_PHOTOS_PER_ALBUM) throw new Error('too_many');
    const id = Utilities.getUuid().slice(0, 12);
    const file = albumFolder().createFile(Utilities.newBlob(Utilities.base64Decode(data), 'image/jpeg', code + '_' + id + '.jpg'));
    const now = Date.now();
    return withLock(() => {
      append('photos', [id, code, file.getId(), clampInt(req.w, 1, 20000), clampInt(req.h, 1, 20000),
        Number(req.time) > 0 ? Math.round(Number(req.time)) : now, req.fromExif ? '1' : '0', req.dateEdited ? '1' : '0',
        str(req.caption, 20), Number(req.ord) > 0 ? Math.round(Number(req.ord)) : now, key, now]);
      return id;
    });
  },

  getPhoto(req) {
    const code = str(req.album, 12), id = str(req.id, 40);
    const p = rows('photos').find(r => r.id === id && r.album === code);
    if (!p) throw new Error('not_found');
    return Utilities.base64Encode(DriveApp.getFileById(p.fileId).getBlob().getBytes());
  },

  updatePhoto(req) {
    const code = str(req.album, 12), id = str(req.id, 40), key = str(req.key, 64);
    return withLock(() => {
      const p = rows('photos').find(r => r.id === id && r.album === code);
      if (!p) throw new Error('not_found');
      const a = findAlbum(code);
      if (!key || (p.key !== key && !(a && a.key === key))) throw new Error('forbidden');
      const ch = {};
      if (req.caption != null) ch.caption = str(req.caption, 20);
      if (req.time != null && Number(req.time) > 0) { ch.time = Math.round(Number(req.time)); ch.dateEdited = '1'; }
      if (req.ord != null && Number(req.ord) > 0) {
        if (!(a && a.key === key)) throw new Error('forbidden');
        ch.ord = Math.round(Number(req.ord));
      }
      setCells('photos', p._row, ch);
      return true;
    });
  },

  deletePhoto(req) {
    const code = str(req.album, 12), id = str(req.id, 40), key = str(req.key, 64);
    return withLock(() => {
      const p = rows('photos').find(r => r.id === id && r.album === code);
      if (!p) throw new Error('not_found');
      const a = findAlbum(code);
      if (!key || (p.key !== key && !(a && a.key === key))) throw new Error('forbidden');
      trashFile(p.fileId);
      deleteRows('photos', [p._row]);
      return true;
    });
  },

  /* ---------- 롤링페이퍼 ---------- */
  getCake(req) {
    const c = findCake(str(req.code, 12));
    if (!c) throw new Error('not_found');
    return { code: c.code, to: c.to, title: c.title, flavor: c.flavor, createdAt: Number(c.createdAt), mine: !!req.key && c.key === req.key };
  },

  createCake(req) {
    const to = str(req.to, 20), title = str(req.title, 30), key = str(req.key, 64);
    const flavor = FLAVORS.indexOf(req.flavor) >= 0 ? req.flavor : 'strawberry';
    if (!to || !key) throw new Error('invalid');
    return withLock(() => {
      const used = {};
      rows('cakes').forEach(r => used[r.code] = true);
      let code;
      do { code = randomCode(); } while (used[code]);
      append('cakes', [code, to, title, flavor, key, Date.now()]);
      return code;
    });
  },

  deleteCake(req) {
    const code = str(req.code, 12);
    return withLock(() => {
      const c = findCake(code);
      if (!c) throw new Error('not_found');
      if (!req.key || c.key !== req.key) throw new Error('forbidden');
      const tops = rows('toppings').filter(t => t.cake === code).map(t => t._row);
      deleteRows('toppings', tops);
      deleteRows('cakes', [c._row]);
      return true;
    });
  },

  listToppings(req) {
    const cake = str(req.cake, 12), key = str(req.key, 64);
    return rows('toppings').filter(t => t.cake === cake).map(t => ({
      id: t.id, sprite: t.sprite, note: t.note, x: Number(t.x), y: Number(t.y),
      name: t.name, text: t.text, createdAt: Number(t.createdAt), mine: !!key && t.key === key
    }));
  },

  addTopping(req) {
    const cake = str(req.cake, 12), key = str(req.key, 64);
    const text = str(req.text, MAX_TEXT), name = str(req.name, 20) || '익명';
    const sprite = SPRITES.indexOf(req.sprite) >= 0 ? req.sprite : 'strawberry';
    const note = NOTES.indexOf(req.note) >= 0 ? req.note : 'cream';
    const x = clampInt(req.x, 0, 159), y = clampInt(req.y, 0, 119);
    if (!text || !key) throw new Error('invalid');
    return withLock(() => {
      if (!findCake(cake)) throw new Error('not_found');
      if (rows('toppings').filter(t => t.cake === cake).length >= MAX_TOPPINGS_PER_CAKE) throw new Error('too_many');
      const id = Utilities.getUuid().slice(0, 12);
      append('toppings', [id, cake, sprite, note, x, y, name, text, key, Date.now()]);
      return id;
    });
  },

  deleteTopping(req) {
    const id = str(req.id, 40), key = str(req.key, 64);
    return withLock(() => {
      const t = rows('toppings').find(r => r.id === id);
      if (!t) throw new Error('not_found');
      const c = findCake(t.cake);
      const allowed = key && (t.key === key || (c && c.key === key));
      if (!allowed) throw new Error('forbidden');
      deleteRows('toppings', [t._row]);
      return true;
    });
  }
};

/* ---------- helpers ---------- */
function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function book() {
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SHEET_ID');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) {} }
  const ss = SpreadsheetApp.create('롤링페이퍼 저장소');
  props.setProperty('SHEET_ID', ss.getId());
  return ss;
}
/** 편집기에서 한 번 실행하면 저장용 시트·사진 폴더를 만들고 권한을 허용받아요. */
function setup() {
  const ss = book();
  sheet('cakes'); sheet('toppings'); sheet('albums'); sheet('photos');
  const folder = albumFolder();
  Logger.log('저장용 시트: ' + ss.getUrl());
  Logger.log('사진 폴더: ' + folder.getUrl());
}
function albumFolder() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('ALBUM_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  const f = DriveApp.createFolder('토핑케이크 사진첩 (사진 저장소)');
  props.setProperty('ALBUM_FOLDER_ID', f.getId());
  return f;
}
function trashFile(id) { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) {} }
function findAlbum(code) {
  return code ? rows('albums').find(r => r.code === code) : null;
}
function setCells(name, row, changes) {
  const sh = sheet(name), h = HEADERS[name];
  Object.keys(changes).forEach(k => {
    const col = h.indexOf(k);
    if (col < 0) return;
    const s = String(changes[k]);
    sh.getRange(row, col + 1).setValue(/^[=+\-@]/.test(s) ? "'" + s : s);
  });
}
function sheet(name) {
  const ss = book();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(HEADERS[name]);
    sh.setFrozenRows(1);
    sh.getRange('A:Z').setNumberFormat('@'); // 모든 값을 글자로 저장
  }
  return sh;
}
function rows(name) {
  const v = sheet(name).getDataRange().getValues();
  const h = v[0];
  return v.slice(1).map((r, i) => {
    const o = { _row: i + 2 };
    h.forEach((k, j) => o[k] = String(r[j]));
    return o;
  });
}
function findCake(code) {
  return code ? rows('cakes').find(r => r.code === code) : null;
}
function append(name, values) {
  // 수식으로 해석되지 않도록 모든 값을 글자로 넣어요
  sheet(name).appendRow(values.map(v => {
    const s = String(v);
    return /^[=+\-@]/.test(s) ? "'" + s : s;
  }));
}
function deleteRows(name, rowNumbers) {
  const sh = sheet(name);
  rowNumbers.sort((a, b) => b - a).forEach(r => sh.deleteRow(r));
}
function withLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function str(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}
function clampInt(v, lo, hi) {
  const n = Math.round(Number(v));
  return isNaN(n) ? lo : Math.max(lo, Math.min(hi, n));
}
function randomCode() {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}
