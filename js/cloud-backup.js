/* ============================================================
   cloud-backup.js — 云端备份（手动一键，不做实时同步）
   ------------------------------------------------------------
   为什么要它：东西本来只存在这台手机上。iOS 长期不打开、清缓存、
   换手机，都可能让待办一夜之间变成空的 —— 这里给它留一份底。

   一次备份 = 把「任务 + 清单 + 设置」写成一个小文件，再把图片
   一张一张搬上去。为什么图片分开传：手机拍的照片转成文字后会很大，
   全塞进一个请求里会被云端直接拒掉。分开传、断一张不至于全废。

   备份码（key）就是钥匙：云端按它分文件夹存。
      · 默认随机生成，界面里能看到、能复制 —— 手机被清空后靠它找回
      · 也允许改成自己好记的（改完记得也记一下）

   跟推送（push.js）的分工：那边传的是"什么时候该叫你"的最小快照，
   这边传的是完整数据。两边各存各的，互不影响。
   ============================================================ */

import { prefs, setPref, collectBackup, importBackup } from "./store.js";

/** 备份服务地址（部署后写死，也可以在 prefs.backupUrl 里覆盖） */
const DEFAULT_URL = "https://qinfweihe1-d5gxpjjli9f8f238b-1497157745.ap-shanghai.app.tcloudbase.com/backup";

/** 备份码：大小写字母数字下划线，6~48 位 */
const KEY_RE = /^[A-Za-z0-9_-]{6,48}$/;
/** 生成备份码时用的字符 — 去掉了容易看错的 i l o 0 1，方便他抄下来 */
const KEY_CHARS = "abcdefghjkmnpqrstuvwxyz23456789";

export function endpoint() {
  return prefs().backupUrl || DEFAULT_URL;
}

/* ---------- 备份码 ---------- */

function randKey(n) {
  const a = new Uint8Array(n || 12);
  if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(a);
  else for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
  let s = "";
  for (let i = 0; i < a.length; i++) s += KEY_CHARS[a[i] % KEY_CHARS.length];
  return s;
}

/** 拿到这台设备用的备份码；没有就生成一个存下来（生成后界面里一直能看到） */
export function backupKey() {
  const k = String(prefs().backupKey || "").trim();
  if (KEY_RE.test(k)) return k;
  const fresh = randKey(12);
  setPref("backupKey", fresh);
  return fresh;
}

/** 备份码格式对不对（大小写字母数字下划线，6~48 位） */
export function validKey(v) {
  return KEY_RE.test(String(v || "").trim());
}

/** 换成他指定的备份码；格式不对返回 false */
export function setBackupKey(k) {
  const v = String(k || "").trim();
  if (!KEY_RE.test(v)) return false;
  setPref("backupKey", v);
  return true;
}

/* ---------- 跟云端说话 ---------- */

async function call(action, payload, timeoutMs) {
  const url = endpoint();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 25000);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ action }, payload || {})),
      signal: ctrl.signal,
    });
    const txt = await r.text();
    let d;
    try {
      d = JSON.parse(txt);
    } catch (e) {
      throw new Error("备份服务返回的内容看不懂");
    }
    // 云函数的"集成响应"会把真数据裹在 body 字段里
    if (d && typeof d.body === "string") {
      try { d = JSON.parse(d.body); } catch (e) { /* 保持原样 */ }
    }
    if (!d || d.ok === false) throw new Error((d && (d.message || d.error)) || "备份服务返回异常");
    return d;
  } catch (e) {
    if (e && e.name === "AbortError") throw new Error("备份服务没响应（网络不通？）");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- 云端有什么 ---------- */

/**
 * @returns {Promise<{exists:boolean, savedAt:number, items:number, images:number, bytes:number}>}
 */
export async function info(key) {
  const k = key || backupKey();
  const d = await call("info", { key: k }, 15000);
  return {
    exists: !!d.exists,
    savedAt: Number(d.savedAt) || 0,
    items: Number(d.items) || 0,
    images: Number(d.images) || 0,
    bytes: Number(d.bytes) || 0,
  };
}

/* ---------- 备上去 ---------- */

/**
 * 把现在手机上的东西备到云端。
 * 顺序是「先图片、后文字」：万一传到一半断了，云上留着的还是上一份完整备份，
 * 不会出现"文字是新的、图片还没到"的半成品。
 *
 * @param {(p:{done:number,total:number,phase:string})=>void} onProgress
 * @returns {Promise<{items:number, images:number, bytes:number, failed:number}>}
 */
export async function save(onProgress) {
  const key = backupKey();
  const p = await collectBackup();
  const ids = Object.keys(p.images);
  const report = (done, phase) => {
    if (onProgress) { try { onProgress({ done, total: ids.length, phase }); } catch (e) { /* 界面报错不该拖垮备份 */ } }
  };

  let failed = 0;
  for (let i = 0; i < ids.length; i++) {
    report(i, "img");
    try {
      await call("img", { key, id: ids[i], data: p.images[ids[i]] }, 30000);
    } catch (e) {
      failed++;
    }
  }
  report(ids.length, "text");

  // 文字最后写：这一个文件写成功，才算这份备份生效
  const savedAt = Date.now();
  await call("put", {
    key,
    payload: {
      v: 2,
      savedAt,
      items: p.items,
      lists: p.lists,
      prefs: p.prefs,
      images: ids,
      bytes: p.bytes,
    },
  }, 30000);

  setPref("backupAt", savedAt);
  setPref("backupItems", p.items.length);
  setPref("backupImages", ids.length);

  return { items: p.items.length, images: ids.length - failed, failed, bytes: p.bytes };
}

/* ---------- 取回来 ---------- */

/**
 * 把云端的备份读回来，覆盖现在手机上的数据。
 * @param {string} [key] 不填就用本机的备份码（换手机时填旧手机的码）
 * @param {(p:{done:number,total:number})=>void} [onProgress]
 * @returns {Promise<{items:number, images:number, failed:number}>}
 */
export async function load(key, onProgress) {
  const k = String(key || "").trim() || backupKey();
  if (!KEY_RE.test(k)) throw new Error("备份码格式不对");

  const d = await call("get", { key: k }, 25000);
  const payload = d && d.payload;
  if (!payload || !Array.isArray(payload.items)) throw new Error("云端还没有这个备份码的备份");

  const ids = Array.isArray(payload.images) ? payload.images : [];
  const images = {};
  let failed = 0;
  for (let i = 0; i < ids.length; i++) {
    if (onProgress) { try { onProgress({ done: i, total: ids.length }); } catch (e) { /* 忽略 */ } }
    try {
      const r = await call("imgget", { key: k, id: ids[i] }, 30000);
      if (r && r.data) images[ids[i]] = r.data;
      else failed++;
    } catch (e) {
      failed++;
    }
  }

  const text = JSON.stringify({
    items: payload.items,
    lists: payload.lists,
    prefs: payload.prefs,
    images,
  });
  const r = await importBackup(text);

  // 用哪个码恢复的，以后就认哪个码
  setBackupKey(k);
  setPref("backupAt", Number(payload.savedAt) || Date.now());
  setPref("backupItems", r.items);
  setPref("backupImages", Object.keys(images).length);

  return { items: r.items, images: Object.keys(images).length, failed };
}

/* ---------- 给界面用的一句话 ---------- */

export function describe() {
  const p = prefs();
  if (!p.backupAt) return "还没备份过。手机万一被清空，就什么都没有了";
  const d = new Date(p.backupAt);
  const when =
    pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  return "上次备份 " + when + " · " + p.backupItems + " 条" + (p.backupImages ? "、" + p.backupImages + " 张图" : "");
}

function pad2(n) {
  return String(n).padStart(2, "0");
}
