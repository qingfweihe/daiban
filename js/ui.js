/* ============================================================
   ui.js — 公共交互件：轻提示 / 底部弹层 / 确认框
   ============================================================ */

import { esc } from "./util.js";

export const SVG = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5.3l3.2 2"/></svg>',
  repeat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2.5l3 3-3 3"/><path d="M20 5.5H8a5 5 0 00-5 5v1"/><path d="M7 21.5l-3-3 3-3"/><path d="M4 18.5h12a5 5 0 005-5v-1"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16M4 10h16M4 15h10"/></svg>',
  img: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="M21 16l-5-5-6 6-3-3-4 4"/></svg>',
  sub: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h10M4 12h7M4 17h10M18 12v9"/></svg>',
  chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  belt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h14M5 20h14M7 4v16M17 4v16M7 12h10"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19.5V5M5.5 11.5L12 5l6.5 6.5"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h4a2 2 0 012 2v12a2 2 0 01-2 2h-4"/><path d="M9 12h11M17 8l4 4-4 4"/></svg>',
  in: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 4H6a2 2 0 00-2 2v12a2 2 0 002 2h4"/><path d="M20 12H9M13 8l-4 4 4 4"/></svg>',
};

/* ---------- 轻提示 ---------- */

let toastTimer = null;
export function toast(msg, ms = 1900) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), ms);
}
window.__toast = toast;

/** 带"撤销"的提示条 */
let undoEl = null;
export function undoToast(msg, onUndo, ms = 4500) {
  clearUndo();
  undoEl = document.createElement("div");
  undoEl.className = "undo-bar";
  undoEl.innerHTML = "<span>" + esc(msg) + "</span><button>撤销</button>";
  undoEl.querySelector("button").onclick = () => {
    clearUndo();
    onUndo && onUndo();
  };
  document.body.appendChild(undoEl);
  setTimeout(clearUndo, ms);
}

function clearUndo() {
  if (undoEl) {
    undoEl.remove();
    undoEl = null;
  }
}

/* ---------- 底部弹层 ---------- */

let sheetCleanup = null;

export function openSheet(opts) {
  const wrap = document.getElementById("sheetWrap");
  const sheet = document.getElementById("sheet");
  const hint = opts.hint ? '<span class="hint">' + esc(opts.hint) + "</span>" : "";
  sheet.innerHTML =
    '<div class="sheet-grab"></div>' +
    '<div class="sheet-head"><h2>' + esc(opts.title || "") + "</h2>" + hint + "</div>" +
    '<div class="sheet-body">' + (opts.body || "") + "</div>";
  wrap.classList.remove("hidden");
  document.body.style.overflow = "hidden";

  const mask = document.getElementById("sheetMask");
  const onMask = () => closeSheet();
  mask.addEventListener("click", onMask);

  sheetCleanup = () => {
    mask.removeEventListener("click", onMask);
    if (opts.onClose) opts.onClose();
  };

  if (opts.onMount) opts.onMount(sheet);
  return sheet;
}

export function closeSheet() {
  const wrap = document.getElementById("sheetWrap");
  if (wrap.classList.contains("hidden")) return;
  wrap.classList.add("hidden");
  document.body.style.overflow = "";
  if (sheetCleanup) {
    const fn = sheetCleanup;
    sheetCleanup = null;
    fn();
  }
}

/** 确认框，返回 Promise<boolean> */
export function confirmBox(msg, okText = "确定", danger = false) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    openSheet({
      title: "确认一下",
      body:
        '<p style="margin:2px 0 4px;font-size:14.5px;line-height:1.65;color:var(--ink-2)">' + esc(msg) + "</p>" +
        '<div class="btn-row"><button class="btn ghost" data-x="no">取消</button>' +
        '<button class="btn ' + (danger ? "danger" : "") + '" data-x="yes">' + esc(okText) + "</button></div>",
      onMount(el) {
        el.querySelector('[data-x="no"]').onclick = () => {
          done(false);
          closeSheet();
        };
        el.querySelector('[data-x="yes"]').onclick = () => {
          done(true);
          closeSheet();
        };
      },
      onClose() {
        done(false);
      },
    });
  });
}

/** 文本输入框，返回 Promise<string|null> */
export function promptBox(title, value = "", placeholder = "", opts = {}) {
  const type = opts.type || "text";
  const hint = opts.hint
    ? '<div class="row-sub" style="margin:-8px 0 14px 2px;line-height:1.6">' + esc(opts.hint) + "</div>"
    : "";
  const okText = opts.okText || "保存";
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    openSheet({
      title,
      body:
        hint +
        '<div class="field"><input class="input" id="pbInput" type="' + type + '" value="' + esc(value) + '" placeholder="' + esc(placeholder) + '" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"></div>' +
        '<div class="btn-row"><button class="btn ghost" data-x="no">取消</button><button class="btn" data-x="yes">' + esc(okText) + "</button></div>",
      onMount(el) {
        const inp = el.querySelector("#pbInput");
        setTimeout(() => inp.focus(), 120);
        inp.onkeydown = (e) => {
          if (e.key === "Enter") {
            done(inp.value.trim());
            closeSheet();
          }
        };
        el.querySelector('[data-x="no"]').onclick = () => {
          done(null);
          closeSheet();
        };
        el.querySelector('[data-x="yes"]').onclick = () => {
          done(inp.value.trim());
          closeSheet();
        };
      },
      onClose() {
        done(null);
      },
    });
  });
}

/** 从若干选项里挑一个，返回 Promise<value|null> */
export function pickBox(title, options, current) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    openSheet({
      title,
      body:
        '<div class="pick-row" style="flex-direction:column;gap:8px;align-items:stretch">' +
        options
          .map(
            (o) =>
              '<button class="pick ' + (o.value === current ? "on" : "") + '" data-v="' + esc(String(o.value)) + '"' +
              ' style="text-align:left;padding:12px 14px;border-radius:11px">' +
              '<div style="font-size:14.5px">' + esc(o.label) + "</div>" +
              (o.hint ? '<div style="font-size:11.5px;opacity:.75;margin-top:2px">' + esc(o.hint) + "</div>" : "") +
              "</button>"
          )
          .join("") +
        "</div>" +
        '<div class="btn-row"><button class="btn ghost" data-x="no">取消</button></div>',
      onMount(el) {
        el.querySelectorAll("[data-v]").forEach((b) => {
          b.onclick = () => {
            done(b.dataset.v);
            closeSheet();
          };
        });
        el.querySelector('[data-x="no"]').onclick = () => {
          done(null);
          closeSheet();
        };
      },
      onClose() {
        done(null);
      },
    });
  });
}
