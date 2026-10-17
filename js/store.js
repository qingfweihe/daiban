/* ============================================================
   store.js — 数据层
   本地优先：所有数据先落在本机，断网、飞行模式都能用。
   云端同步与 AI 只是"增强"，不参与核心读写。
   ============================================================ */

import { uid, todayYmd, fmtDate, addDays, diffDays, parseYmd, nextDue, repeatLabel } from "./util.js";

const KEY = "daiban_v1";
const BLOB_DB = "daiban_blobs";

const DEFAULT = {
  version: 1,
  lists: [
    { id: "l_inbox", name: "收件箱", icon: "💡", color: "#9b8cff", type: "inbox", sort: 0 },
    { id: "l_study", name: "备考任务", icon: "📘", color: "#e8618e", type: "study", sort: 1 },
    { id: "l_life", name: "生活杂事", icon: "🏠", color: "#5b8def", type: "life", sort: 2 },
    { id: "l_long", name: "长期推进", icon: "🎯", color: "#e0992e", type: "long", sort: 3 },
  ],
  items: [],
  prefs: {
    prefsV: 4,                                          // 配置版本，用于给老数据补默认值
    aiOn: true,
    aiUrl: "https://qinfweihe1-d5gxpjjli9f8f238b-1497157745.ap-shanghai.app.tcloudbase.com/todo",
    // 密钥留空 = 用云函数内置的那条通道，开箱即用，不用他配。
    // 填了才会覆盖成自己的（也只存本机）。
    aiKey: "",
    aiBase: "https://api.seventoken.shop/v1",
    aiModel: "gemini-3-flash",
    defaultListId: "l_inbox",
    remindAhead: 0,       // 提前多少分钟提醒（0 = 到点提醒）
    remindOn: true,
    dailyBriefOn: true,   // 每天早上汇总今天要做什么
    inboxCleanOn: true,
    inboxCleanTime: "21:00",
    lastInboxClean: "",
    lastBrief: "",
    exportAlarmMin: 15,
    // —— 云端推送（关掉软件也能到点提醒）——
    pushOn: false,        // 默认关着：得先装到主屏幕、允许通知才有意义
    pushId: "",           // 这台设备的随机号，云端靠它区分"谁的手机"
    pushUrl: "",          // 留空就用 push.js 里的默认地址
    pushSyncedAt: 0,      // 上次把清单交给云端的时间
  },
};

/* ---------- 载入 / 保存 ---------- */

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

let state = null;
const subs = new Set();
let saveTimer = null;

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return clone(DEFAULT);
    const d = JSON.parse(raw);
    Object.keys(DEFAULT).forEach((k) => {
      if (d[k] === undefined) d[k] = clone(DEFAULT[k]);
    });
    d.prefs = Object.assign({}, DEFAULT.prefs, d.prefs || {});
    // 老数据补默认值（v1 → v2：加入 AI 相关配置；v2 → v3：加入云端推送）
    if (!(d.prefs.prefsV >= 2)) {
      if (!d.prefs.aiUrl) d.prefs.aiUrl = DEFAULT.prefs.aiUrl;
      if (!d.prefs.aiBase) d.prefs.aiBase = DEFAULT.prefs.aiBase;
      if (!d.prefs.aiModel) d.prefs.aiModel = DEFAULT.prefs.aiModel;
      d.prefs.prefsV = 2;
    }
    if (!(d.prefs.prefsV >= 3)) {
      // 推送默认关着 —— 不能替用户决定"要不要把清单传到云端"
      if (d.prefs.pushOn === undefined) d.prefs.pushOn = false;
      if (!d.prefs.pushId) d.prefs.pushId = "";
      d.prefs.prefsV = 3;
    }
    if (!(d.prefs.prefsV >= 4)) {
      // v3 → v4：AI 换成内置通道，用户不必再填密钥。
      // 只有"没动过"的旧默认值才换；他自己选过模型/填过密钥的，一律不动。
      const oldBase = "https://dashscope.aliyuncs.com/compatible-mode/v1";
      const untouched = !d.prefs.aiKey && (!d.prefs.aiBase || d.prefs.aiBase === oldBase);
      if (untouched) {
        d.prefs.aiBase = DEFAULT.prefs.aiBase;
        d.prefs.aiModel = DEFAULT.prefs.aiModel;
      }
      d.prefs.prefsV = 4;
    }
    if (!Array.isArray(d.items)) d.items = [];
    if (!Array.isArray(d.lists) || !d.lists.length) d.lists = clone(DEFAULT.lists);
    d.items.forEach(normalize);
    return d;
  } catch (e) {
    console.warn("数据读取失败，已重置为空", e);
    return clone(DEFAULT);
  }
}

function normalize(it) {
  if (!it.id) it.id = uid();
  if (typeof it.title !== "string") it.title = String(it.title || "");
  if (typeof it.note !== "string") it.note = "";
  if (!Array.isArray(it.tags)) it.tags = [];
  if (!Array.isArray(it.imgs)) it.imgs = [];
  if (typeof it.done !== "boolean") it.done = false;
  if (it.priority == null) it.priority = 0;
  if (it.due === undefined) it.due = null;
  if (it.time === undefined) it.time = null;
  if (it.repeat === undefined) it.repeat = null;
  if (it.parentId === undefined) it.parentId = null;
  if (it.listId === undefined) it.listId = "l_inbox";
  if (it.sort == null) it.sort = 0;
  if (!it.createdAt) it.createdAt = Date.now();
  return it;
}

export function init() {
  if (!state) state = load();
  return state;
}

function persist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      console.error("保存失败（可能是空间满了）", e);
      if (window.__toast) window.__toast("保存失败：手机存储可能满了");
    }
  }, 60);
}

function notify(evt) {
  persist();
  subs.forEach((fn) => {
    try { fn(evt || {}); } catch (e) { console.error(e); }
  });
}

export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function getState() {
  return state;
}

/* ---------- 任务 CRUD ---------- */

export function allItems() {
  return state.items;
}

export function getItem(id) {
  return state.items.find((x) => x.id === id) || null;
}

export function addItem(data) {
  const it = normalize(
    Object.assign(
      {
        id: uid(),
        listId: state.prefs.defaultListId || "l_inbox",
        title: "",
        note: "",
        due: null,
        time: null,
        repeat: null,
        priority: 0,
        tags: [],
        imgs: [],
        done: false,
        doneAt: null,
        parentId: null,
        sort: 0,
        createdAt: Date.now(),
      },
      data
    )
  );
  state.items.unshift(it);
  notify({ type: "add", item: it });
  return it;
}

export function updateItem(id, patch) {
  const it = getItem(id);
  if (!it) return null;
  Object.assign(it, patch);
  normalize(it);
  notify({ type: "update", item: it });
  return it;
}

export function removeItem(id) {
  const kids = state.items.filter((x) => x.parentId === id).map((x) => x.id);
  state.items = state.items.filter((x) => x.id !== id && x.parentId !== id);
  kids.concat([id]).forEach((k) => dropBlob(k).catch(() => {}));
  notify({ type: "remove", id });
}

/**
 * 打勾 / 取消打勾。
 * 重复任务被完成时：当前这条标记完成，同时自动生成下一次的实例。
 */
export function toggleItem(id) {
  const it = getItem(id);
  if (!it) return null;
  it.done = !it.done;
  it.doneAt = it.done ? Date.now() : null;

  let spawned = null;
  if (it.done && it.repeat) {
    const nd = nextDue(it.due || todayYmd(), it.repeat);
    if (nd) {
      spawned = addItem({
        listId: it.listId,
        title: it.title,
        note: it.note,
        due: nd,
        time: it.time,
        repeat: clone(it.repeat),
        priority: it.priority,
        tags: it.tags.slice(),
      });
    }
  }

  // 父任务完成后把未完成的子任务保持原样，由用户自行处理
  notify({ type: "toggle", item: it, spawned });
  return { item: it, spawned };
}

export function addSubTask(parentId, title) {
  const p = getItem(parentId);
  if (!p) return null;
  return addItem({ parentId, title, listId: p.listId, due: p.due, priority: 0 });
}

export function subtasksOf(parentId) {
  return state.items.filter((x) => x.parentId === parentId);
}

export function moveItem(id, listId) {
  return updateItem(id, { listId });
}

/* ---------- 清单 ---------- */

export function lists() {
  return state.lists.slice().sort((a, b) => a.sort - b.sort);
}

export function getList(id) {
  return state.lists.find((x) => x.id === id) || null;
}

export function addList(data) {
  const l = Object.assign(
    { id: uid("l"), name: "新清单", icon: "📌", color: "#e8618e", type: "custom", sort: state.lists.length },
    data
  );
  state.lists.push(l);
  notify({ type: "list" });
  return l;
}

export function updateList(id, patch) {
  const l = getList(id);
  if (!l) return;
  Object.assign(l, patch);
  notify({ type: "list" });
}

export function removeList(id) {
  state.lists = state.lists.filter((x) => x.id !== id);
  const inbox = state.lists.find((x) => x.type === "inbox") || state.lists[0];
  state.items.forEach((it) => {
    if (it.listId === id) it.listId = inbox ? inbox.id : "l_inbox";
  });
  notify({ type: "list" });
}

/* ---------- 偏好 ---------- */

export function prefs() {
  return state.prefs;
}

export function setPref(k, v) {
  state.prefs[k] = v;
  notify({ type: "pref" });
}

/* ---------- 标签 ---------- */

export function allTags() {
  const m = new Map();
  state.items.forEach((it) => {
    (it.tags || []).forEach((t) => m.set(t, (m.get(t) || 0) + 1));
  });
  return Array.from(m.entries())
    .map(([name, cnt]) => ({ name, cnt }))
    .sort((a, b) => b.cnt - a.cnt || a.name.localeCompare(b.name, "zh"));
}

/* ---------- 查询 ---------- */

export function pendingOf(listId) {
  return state.items
    .filter((x) => !x.parentId && x.listId === listId)
    .sort(sortItems);
}

export function sortItems(a, b) {
  if (a.done !== b.done) return a.done ? 1 : -1;
  if (a.due && b.due) {
    if (a.due !== b.due) return a.due < b.due ? -1 : 1;
    const at = a.time || "99:99";
    const bt = b.time || "99:99";
    if (at !== bt) return at < bt ? -1 : 1;
  } else if (a.due) return -1;
  else if (b.due) return 1;
  if (a.priority !== b.priority) return b.priority - a.priority;
  return (b.createdAt || 0) - (a.createdAt || 0);
}

/** 今天页用的三组：逾期 / 今天 / 稍后（近 7 天） */
export function todayBuckets() {
  const t = todayYmd();
  const all = state.items.filter((x) => !x.parentId);
  const over = [];
  const todays = [];
  const soon = [];
  const noDate = [];

  all.forEach((it) => {
    if (it.done) {
      if (it.doneAt && new Date(it.doneAt).toDateString() === new Date().toDateString()) todays.push(it);
      return;
    }
    if (!it.due) { noDate.push(it); return; }
    const d = diffDays(it.due, t);
    if (d < 0) over.push(it);
    else if (d === 0) todays.push(it);
    else if (d <= 7) soon.push(it);
  });

  over.sort(sortItems);
  todays.sort(sortItems);
  soon.sort(sortItems);
  noDate.sort(sortItems);
  return { over, todays, soon, noDate };
}

export function byDate(dateStr) {
  return state.items
    .filter((x) => !x.parentId && x.due === dateStr)
    .sort(sortItems);
}

export function searchItems(q) {
  const k = String(q || "").trim().toLowerCase();
  if (!k) return [];
  return state.items.filter((it) => {
    if (it.parentId) return false;
    const hay = [it.title, it.note, (it.tags || []).join(" ")].join(" ").toLowerCase();
    return hay.indexOf(k) >= 0;
  }).sort(sortItems);
}

/* ---------- 统计 ---------- */

function startOfWeek() {
  const d = new Date();
  const w = d.getDay() === 0 ? 6 : d.getDay() - 1; // 周一为一周开始
  d.setDate(d.getDate() - w);
  return d;
}

export function stats() {
  const all = state.items.filter((x) => !x.parentId);
  const doneItems = all.filter((x) => x.done && x.doneAt);
  const t = new Date();

  // 本周完成
  const ws = startOfWeek().getTime();
  const weekDone = doneItems.filter((x) => x.doneAt >= ws).length;

  // 近 7 天每天完成数
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toDateString();
    const cnt = doneItems.filter((x) => new Date(x.doneAt).toDateString() === key).length;
    days.push({ label: i === 0 ? "今天" : String(d.getMonth() + 1) + "/" + d.getDate(), cnt, isToday: i === 0 });
  }

  // 连续天数（从今天往前，有完成记录就算）
  const doneSet = new Set(doneItems.map((x) => new Date(x.doneAt).toDateString()));
  let streak = 0;
  const cursor = new Date();
  if (!doneSet.has(cursor.toDateString())) cursor.setDate(cursor.getDate() - 1);
  while (doneSet.has(cursor.toDateString())) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  const pending = all.filter((x) => !x.done).length;
  const todayList = byDate(todayYmd());
  const todayDone = todayList.filter((x) => x.done).length;

  return { weekDone, days, streak, pending, total: all.length, todayTotal: todayList.length, todayDone };
}

/* ---------- 附件（图片） ---------- */

let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(BLOB_DB, 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains("blobs")) r.result.createObjectStore("blobs");
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

export async function putBlob(id, blob) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction("blobs", "readwrite");
    tx.objectStore("blobs").put(blob, id);
    tx.oncomplete = () => res(id);
    tx.onerror = () => rej(tx.error);
  });
}

export async function getBlob(id) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction("blobs", "readonly");
    const rq = tx.objectStore("blobs").get(id);
    rq.onsuccess = () => res(rq.result || null);
    rq.onerror = () => rej(rq.error);
  });
}

export async function dropBlob(id) {
  const d = await db();
  return new Promise((res) => {
    const tx = d.transaction("blobs", "readwrite");
    tx.objectStore("blobs").delete(id);
    tx.oncomplete = () => res();
    tx.onerror = () => res();
  });
}

/** 压缩图片：最长边 900，JPEG q0.72 */
export function compressImage(file, maxSide = 900, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width: w, height: h } = img;
        const scale = Math.min(1, maxSide / Math.max(w, h));
        w = Math.round(w * scale);
        h = Math.round(h * scale);
        const cv = document.createElement("canvas");
        cv.width = w;
        cv.height = h;
        cv.getContext("2d").drawImage(img, 0, 0, w, h);
        cv.toBlob((b) => (b ? resolve(b) : reject(new Error("压缩失败"))), "image/jpeg", quality);
      };
      img.onerror = () => reject(new Error("图片读取失败"));
      img.src = fr.result;
    };
    fr.onerror = () => reject(new Error("文件读取失败"));
    fr.readAsDataURL(file);
  });
}

/* ---------- 导入 / 导出 ---------- */

export function exportJSON() {
  return JSON.stringify(state, null, 2);
}

export function importJSON(text) {
  const d = JSON.parse(text);
  if (!d || !Array.isArray(d.items)) throw new Error("文件格式不对");
  if (!Array.isArray(d.lists) || !d.lists.length) d.lists = clone(DEFAULT.lists);
  d.prefs = Object.assign({}, DEFAULT.prefs, d.prefs || {});
  d.items.forEach(normalize);
  state = d;
  notify({ type: "import" });
  return d.items.length;
}

export function clearDone() {
  const n = state.items.filter((x) => x.done).length;
  state.items = state.items.filter((x) => !x.done);
  notify({ type: "clear" });
  return n;
}

export function wipe() {
  state = clone(DEFAULT);
  notify({ type: "wipe" });
}
