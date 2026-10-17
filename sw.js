/* ============================================================
   sw.js — Service Worker
   作用：① 让手机允许"装到主屏幕"；② 断网也能打开；③ 收到通知点击回到应用。
   策略：页面走"先联网、失败用缓存"（保证改动立刻生效）；
        图标等静态资源走"先用缓存、后台偷偷更新"。
   ============================================================ */

const CACHE = "daiban-20261017-230035"; // 改了核心文件就升一位，否则装过的人会一直用旧缓存

const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./manifest.webmanifest",
  "./js/main.js",
  "./js/util.js",
  "./js/store.js",
  "./js/ui.js",
  "./js/render.js",
  "./js/push.js",
  "./js/cloud-backup.js",
  "./js/page-today.js",
  "./js/page-lists.js",
  "./js/page-calendar.js",
  "./js/page-me.js",
  "./js/sheet-item.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS).catch(() => {})).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  // 跨域（比如 AI 云函数）一律走网络，不掺和
  if (url.origin !== self.location.origin) return;

  const isDoc = req.mode === "navigate" || (req.headers.get("accept") || "").indexOf("text/html") >= 0;

  if (isDoc) {
    // 页面：先联网，失败回缓存
    e.respondWith(
      fetch(req)
        .then((r) => {
          const copy = r.clone();
          caches.open(CACHE).then((c) => c.put("./index.html", copy)).catch(() => {});
          return r;
        })
        .catch(() => caches.match("./index.html").then((r) => r || caches.match("./")))
    );
    return;
  }

  // 静态资源：先给缓存，同时后台更新
  e.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req)
        .then((r) => {
          const copy = r.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return r;
        })
        .catch(() => cached);
      return cached || net;
    })
  );
});

/* 收到推送 / 通知点击 */
self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { data = { title: "待办", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(
    self.registration.showNotification(data.title || "待办", {
      body: data.body || "",
      icon: "./icons/icon-192.png",
      badge: "./icons/icon-192.png",
      tag: data.tag || "daiban",
      // 同一个任务到点只弹一条：重复任务生成新实例后 tag 会变，不会互相吞掉
      renotify: true,
      data: { url: data.url || "./" },
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      // 已经开着 → 直接把它叫到前台；带了具体任务的话让页面自己处理（改成跳到那条）
      for (const c of list) {
        if ("focus" in c) {
          if (url && url !== "./") {
            try {
              const u = new URL(url, self.location.origin);
              if (u.search && c.navigate) return c.navigate(u.href).then((w) => (w && w.focus) ? w.focus() : w);
            } catch (err) { /* 地址怪就退回普通聚焦 */ }
          }
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
