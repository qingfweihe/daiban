/* ============================================================
   push.js — 云端推送（关掉软件也能到点提醒）
   ------------------------------------------------------------
   和 main.js 里那套"打开时检查"的区别：
     · main.js 的叫本地提醒 —— 只有页面开着才有效，锁屏就没戏
     · 这里叫云端提醒 —— 手机端把"哪些时候该叫我"交给云端存着，
       云函数每 5 分钟扫一遍，到点直接推系统通知。软件关着、手机锁屏都收得到。

   前提（缺一不可）：
     1. 把软件装到手机主屏幕（iPhone 尤其必须，否则系统不给通知权限）
     2. 允许通知
     3. 网络通 —— 订阅信息要传到云端

   云端只拿"该在什么时候叫醒你"所需的最小信息：标题、日期、时间、重复规则、
   提前量。备注、清单、标签一律不上传。
   ============================================================ */

import { prefs, setPref, allItems } from "./store.js";

/** 云端推送服务的地址（部署后写死，也可以在「我的」里改） */
const DEFAULT_URL = "https://qinfweihe1-d5gxpjjli9f8f238b-1497157745.ap-shanghai.app.tcloudbase.com/notify";
const ID_RE = /^[A-Za-z0-9_-]{8,48}$/;

/* ---------- 环境判断 ---------- */

export function supported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** 是不是"装到主屏幕后从图标打开的"（iOS 上这是收通知的硬条件） */
export function standalone() {
  try {
    if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return true;
  } catch (e) { /* 老浏览器 */ }
  return window.navigator.standalone === true;
}

export function isIOS() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent);
}

export function permission() {
  try { return Notification.permission; } catch (e) { return "denied"; }
}

export function endpoint() {
  return prefs().pushUrl || DEFAULT_URL;
}

/* ---------- 设备号 ---------- */

/** 每台设备一个随机号，云端靠它区分"谁的手机"。生成一次就存本机，不换 */
export function deviceId() {
  let id = prefs().pushId;
  if (id && ID_RE.test(id)) return id;
  id = randId();
  setPref("pushId", id);
  return id;
}

function randId() {
  const a = new Uint8Array(15);
  if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(a);
  else for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
  let s = "";
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return "d" + btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/* ---------- 跟云端说话 ---------- */

async function call(action, payload, timeoutMs) {
  const url = endpoint();
  if (!url) throw new Error("推送服务地址还没配好");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 12000);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ action, id: deviceId() }, payload || {})),
      signal: ctrl.signal,
    });
    const txt = await r.text();
    let d;
    try { d = JSON.parse(txt); } catch (e) { throw new Error("推送服务返回的内容看不懂"); }
    // 云函数的"集成响应"会把真数据裹在 body 字段里
    if (d && typeof d.body === "string") { try { d = JSON.parse(d.body); } catch (e) { /* 保持原样 */ } }
    if (!d || d.ok === false) throw new Error((d && (d.message || d.error)) || "推送服务返回异常");
    return d;
  } catch (e) {
    if (e && e.name === "AbortError") throw new Error("推送服务没响应（网络不通？）");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- 要交给云端的那份清单 ---------- */

/**
 * 挑出"需要云端叫醒"的待办。
 * 规则：有日期、没做完、不是子任务，而且提醒没被明确关掉。
 * 提醒设置有三种状态：
 *   undefined → 从没动过 → 跟着"到点提醒"走（到点就叫）
 *   null      → 用户明确选了"不提醒"
 *   数字      → 提前 N 分钟
 */
export function pickItems() {
  const out = [];
  for (const it of allItems()) {
    if (it.parentId) continue;
    if (it.done) continue;
    if (!it.due) continue;
    if (it.remindAhead === null) continue;
    out.push({
      id: it.id,
      title: it.title || "有件事到点啦",
      due: it.due,
      time: it.time || null,
      repeat: it.repeat || null,
      remindAhead: it.remindAhead === undefined ? 0 : it.remindAhead,
      done: false,
    });
  }
  return out;
}

/* ---------- 上传快照（节流） ---------- */

let snapTimer = null;

/**
 * 把待办清单交给云端。改完一条会连着改好几条，所以默认攒 2.5 秒再发一次。
 * @param {boolean} now 立刻发（开启开关、手动点同步时用）
 */
export async function syncSnapshot(now) {
  if (!prefs().pushOn) return null;
  clearTimeout(snapTimer);
  if (!now) {
    return new Promise((resolve) => {
      snapTimer = setTimeout(() => { doSync().then(resolve).catch(() => resolve(null)); }, 2500);
    });
  }
  return doSync();
}

async function doSync() {
  const items = pickItems();
  const r = await call("snapshot", { items, remindOn: true, tz: -new Date().getTimezoneOffset() }, 15000);
  setPref("pushSyncedAt", Date.now());
  return r;
}

/* ---------- 订阅（Web Push 那一层） ---------- */

function urlBase64ToUint8Array(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const s = (b64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(s);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** 订阅是不是用当前这把公钥建的？换了服务器之后旧订阅会被苹果/谷歌直接拒收 */
function sameKey(sub, pubB64) {
  try {
    const cur = sub && sub.options && sub.options.applicationServerKey;
    if (!cur) return false;
    const a = new Uint8Array(cur);
    const b = urlBase64ToUint8Array(pubB64);
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  } catch (e) {
    return false;
  }
}

function withTimeout(p, ms, msg) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(msg || "等太久了（网络不通？）")), ms)),
  ]);
}

/** 拿到和当前云端公钥匹配的订阅；不匹配就作废重建 */
async function ensureFreshSub() {
  const reg = await navigator.serviceWorker.ready;
  const pk = await call("pubkey", {}, 12000);
  if (!pk.publicKey) throw new Error("云端没给出推送公钥");
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub, pk.publicKey)) {
    try { await sub.unsubscribe(); } catch (e) { /* 忽略 */ }
    sub = null;
  }
  if (!sub) {
    sub = await withTimeout(
      reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(pk.publicKey) }),
      20000,
      "手机没能建立推送订阅（可能是网络连不上推送服务）"
    );
  }
  return sub;
}

/* ---------- 对外四件事：开 / 关 / 测 / 自愈 ---------- */

export async function enable() {
  if (!supported()) {
    throw new Error(isIOS() ? "这个浏览器不行。iPhone 要先用 Safari 把软件「添加到主屏幕」，再从桌面图标打开。" : "这个浏览器不支持系统通知");
  }
  if (isIOS() && !standalone()) {
    throw new Error("iPhone 上必须先从桌面图标打开（先「添加到主屏幕」）才能收通知");
  }
  if (permission() !== "granted") {
    let p = "denied";
    try { p = await Notification.requestPermission(); } catch (e) { /* 老浏览器 */ }
    if (p !== "granted") throw new Error("通知权限没允许 —— 收不到提醒的。去浏览器设置里改成「允许」再回来");
  }

  const sub = await ensureFreshSub();
  await call("subscribe", { subscription: sub.toJSON(), ua: String(navigator.userAgent).slice(0, 110) }, 15000);
  setPref("pushOn", true);
  await syncSnapshot(true);
  return { items: pickItems().length };
}

export async function disable() {
  setPref("pushOn", false);
  try { await call("unsubscribe", {}, 10000); } catch (e) { /* 云端清不掉也不影响本机关掉 */ }
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
  } catch (e) { /* 忽略 */ }
  return true;
}

/** 让云端立刻推一条测试通知 */
export async function sendTest() {
  return call("testpush", {}, 25000);
}

/** 看看云端现在记着多少条 */
export async function status() {
  return call("status", {}, 12000);
}

/**
 * 启动自愈。
 * 换过推送服务器、或者订阅在系统里被悄悄清掉的情况，用户自己是看不出来的 ——
 * 只会觉得"怎么不提醒了"。这里悄悄地检查一遍、该修就修。
 * 不主动新建订阅（有些浏览器要求必须由用户点击触发）。
 */
export async function repair() {
  if (!prefs().pushOn) return null;
  if (!supported() || permission() !== "granted") return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return null;
    const pk = await call("pubkey", {}, 10000);
    if (sameKey(sub, pk.publicKey)) {
      await syncSnapshot(true);          // 顺便把清单对齐一次
      return { ok: true, repaired: false };
    }
    const fresh = await ensureFreshSub();
    await call("subscribe", { subscription: fresh.toJSON(), ua: String(navigator.userAgent).slice(0, 110) }, 15000);
    await syncSnapshot(true);
    return { ok: true, repaired: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/* ---------- 给界面用的一句话说明 ---------- */

/**
 * @returns {{on:boolean, tone:"ok"|"warn"|"off"|"err", text:string}}
 */
export function describe() {
  const p = prefs();
  if (!p.pushOn) {
    if (!supported()) {
      return { on: false, tone: "warn", text: "这台设备的浏览器不支持系统通知 —— 在手机上要「添加到主屏幕」后再从桌面图标打开。" };
    }
    if (isIOS() && !standalone()) {
      return { on: false, tone: "warn", text: "iPhone 上要先「添加到主屏幕」，再从桌面图标打开，才能收通知。" };
    }
    return { on: false, tone: "off", text: "没开 —— 现在只有你打开软件那会儿才会提醒。" };
  }
  if (!supported()) {
    return { on: true, tone: "err", text: "这台设备的浏览器不支持系统通知。" };
  }
  if (permission() !== "granted") {
    return { on: true, tone: "err", text: "通知权限被关掉了，去浏览器设置里改成「允许」。" };
  }
  if (isIOS() && !standalone()) {
    return { on: true, tone: "err", text: "要先把软件「添加到主屏幕」，再从桌面图标打开。" };
  }
  const n = pickItems().length;
  const t = p.pushSyncedAt ? new Date(p.pushSyncedAt) : null;
  const when = t ? "　上次同步 " + pad2(t.getHours()) + ":" + pad2(t.getMinutes()) : "";
  return {
    on: true,
    tone: "ok",
    text: "开着 —— 云端记着 " + n + " 条带提醒的待办，到点直接推系统通知。" + when,
  };
}

function pad2(n) {
  return String(n).padStart(2, "0");
}
