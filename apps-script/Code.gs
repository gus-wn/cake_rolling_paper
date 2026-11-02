/**
 * 토핑케이크 롤링페이퍼 — 저장공간(구글 시트) 스크립트
 *
 * script.new(새 Apps Script) 또는 구글 시트 > 확장 프로그램 > Apps Script 에
 * 이 파일 내용을 그대로 붙여 넣고, 배포 > 새 배포 > 웹 앱
 * (실행: 나 / 액세스 권한: 모든 사용자) 로 배포하세요.
 * 시트에 붙인 경우 그 시트에, script.new 로 만든 경우 내 드라이브에
 * '롤링페이퍼 저장소' 시트를 자동으로 만들어 저장합니다.
 */

const HEADERS = {
  cakes:    ['code', 'to', 'title', 'flavor', 'key', 'createdAt'],
  toppings: ['id', 'cake', 'sprite', 'note', 'x', 'y', 'name', 'text', 'key', 'createdAt']
};
const FLAVORS = ['strawberry', 'choco', 'matcha', 'lavender'];
const SPRITES = ['strawberry', 'cherry', 'candle', 'heart', 'star', 'macaron', 'cookie', 'blueberry', 'cream', 'flower', 'choco', 'gummy'];
const NOTES = ['cream', 'berry', 'mint', 'sky', 'lav'];
const MAX_TOPPINGS_PER_CAKE = 200;
const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';

function doGet() {
  return out({ ok: true, data: '토핑케이크 롤링페이퍼 저장공간이 작동하고 있어요.' });
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
    const text = str(req.text, 500), name = str(req.name, 20) || '익명';
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
/** 편집기에서 한 번 실행하면 저장용 시트를 만들고 주소를 로그에 보여 줘요. */
function setup() {
  const ss = book();
  sheet('cakes'); sheet('toppings');
  Logger.log('저장용 시트: ' + ss.getUrl());
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
