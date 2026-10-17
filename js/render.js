/* ============================================================
   render.js — 复用片段：任务行、分组、进度条
   ============================================================ */

import { esc, fmtDate, repeatLabel, todayYmd, diffDays, parseYmd } from "./util.js";
import { subtasksOf } from "./store.js";
import { SVG } from "./ui.js";

/** 到期时间的显示文本 + 状态样式类 */
function dueInfo(it) {
  if (!it.due) return null;
  const t = todayYmd();
  const d = diffDays(it.due, t);
  const txt = fmtDate(it.due) + (it.time ? " " + it.time : "");
  let cls = "";
  if (!it.done) {
    if (d < 0) cls = "due-over";
    else if (d === 0) cls = "due-soon";
  }
  return { txt, cls };
}

/**
 * 一条任务
 * @param {object} it 任务
 * @param {object} opt { sub:boolean 是否是子任务行, listName:string 显示清单名 }
 */
export function taskHTML(it, opt = {}) {
  const cls = [
    "task",
    it.done ? "done" : "",
    it.priority === 2 ? "pri-2" : it.priority === 1 ? "pri-1" : "",
    opt.sub ? "as-sub" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const meta = [];
  const due = dueInfo(it);
  if (due) meta.push('<span class="m ' + due.cls + '">' + SVG.cal + due.txt + "</span>");
  if (it.repeat) meta.push('<span class="m repeat">' + SVG.repeat + esc(repeatLabel(it.repeat)) + "</span>");
  if (it.note) meta.push('<span class="m">' + SVG.note + "</span>");
  if (it.imgs && it.imgs.length) meta.push('<span class="m">' + SVG.img + it.imgs.length + "</span>");
  if (opt.listName) meta.push('<span class="m">' + esc(opt.listName) + "</span>");
  (it.tags || []).slice(0, 3).forEach((t) => meta.push('<span class="tag-mini">#' + esc(t) + "</span>"));

  // 子任务进度
  let progress = "";
  if (!opt.sub) {
    const kids = subtasksOf(it.id);
    if (kids.length) {
      const dn = kids.filter((k) => k.done).length;
      const pct = Math.round((dn / kids.length) * 100);
      progress =
        '<div class="progress-line"><div class="bar"><i style="width:' + pct + '%"></i></div>' +
        "<span>" + dn + "/" + kids.length + "</span></div>";
    }
  }

  return (
    '<div class="' + cls + '" data-id="' + it.id + '">' +
    '<button class="tick" data-act="toggle" aria-label="完成">' + SVG.check + "</button>" +
    '<div class="task-body" data-act="open">' +
    '<div class="task-title">' + esc(it.title || "(没写内容)") + "</div>" +
    (meta.length ? '<div class="task-meta">' + meta.join("") + "</div>" : "") +
    progress +
    "</div></div>"
  );
}

/** 带子任务的任务：主任务 + 缩进的子任务 */
export function taskWithSubsHTML(it) {
  const kids = subtasksOf(it.id);
  let html = taskHTML(it);
  if (kids.length) {
    html += '<div class="sub-list">' + kids.map((k) => taskHTML(k, { sub: true })).join("") + "</div>";
  }
  return html;
}

/** 一个分组（逾期 / 今天 / 稍后 …） */
export function groupHTML(title, items, opt = {}) {
  if (!items.length) return "";
  const head =
    '<div class="group-head ' + (opt.cls || "") + '"><span>' + esc(title) + "</span>" +
    '<span class="cnt">' + items.length + "</span><span class=\"line\"></span></div>";
  const body = items.map((it) => (opt.plain ? taskHTML(it, opt) : taskWithSubsHTML(it))).join("");
  return '<div class="group">' + head + body + "</div>";
}

/** 空态 */
export function emptyHTML(icon, text, hint) {
  return (
    '<div class="empty"><div class="em-ico">' + icon + "</div><p>" + text + "</p>" +
    (hint ? '<p class="em-hint">' + hint + "</p>" : "") +
    "</div>"
  );
}

/** 折叠的"已完成"区块 */
export function doneFoldHTML(items) {
  if (!items.length) return "";
  return (
    '<details class="group done-fold"><summary>' +
    "<span>今天已完成 " + items.length + " 件</span></summary>" +
    items.map((it) => taskHTML(it)).join("") +
    "</details>"
  );
}
