/* ============================================================
   page-calendar.js — 日历页（月视图 + 某天的任务）
   ============================================================ */

import { getState, byDate, stats } from "./store.js";
import { taskHTML, emptyHTML } from "./render.js";
import { SVG } from "./ui.js";
import { todayYmd, ymd, esc, fmtDate } from "./util.js";

const WD = ["日", "一", "二", "三", "四", "五", "六"];

export const calState = { ym: null, sel: null };

export function initCal() {
  const t = new Date();
  calState.ym = t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0");
  calState.sel = todayYmd();
}

function dayCounts() {
  const st = getState();
  const map = {};
  st.items.forEach((it) => {
    if (!it.due || it.parentId) return;
    if (!map[it.due]) map[it.due] = { total: 0, done: 0, over: false };
    map[it.due].total++;
    if (it.done) map[it.due].done++;
  });
  const t = todayYmd();
  Object.keys(map).forEach((k) => {
    if (k < t && map[k].done < map[k].total) map[k].over = true;
  });
  return map;
}

export function calHTML() {
  const [y, m] = calState.ym.split("-").map(Number);
  const counts = dayCounts();
  const today = todayYmd();
  const first = new Date(y, m - 1, 1);
  const lead = first.getDay();
  const dim = new Date(y, m, 0).getDate();
  const prevDim = new Date(y, m - 1, 0).getDate();

  const cells = [];
  for (let i = lead - 1; i >= 0; i--) {
    const d = new Date(y, m - 2, prevDim - i);
    cells.push({ date: ymd(d), day: prevDim - i, out: true });
  }
  for (let i = 1; i <= dim; i++) {
    const d = new Date(y, m - 1, i);
    cells.push({ date: ymd(d), day: i, out: false });
  }
  while (cells.length % 7 !== 0 || cells.length < 42) {
    const last = cells[cells.length - 1].date;
    const nd = new Date(last);
    nd.setDate(nd.getDate() + 1);
    cells.push({ date: ymd(nd), day: nd.getDate(), out: true });
    if (cells.length >= 42) break;
  }

  const grid =
    '<div class="cal-grid">' +
    WD.map((w) => '<div class="cal-dow">' + w + "</div>").join("") +
    cells
      .map((c) => {
        const info = counts[c.date];
        let dots = "";
        if (info) {
          const n = Math.min(3, info.total - info.done || (info.done ? 1 : 0));
          let cls = "cal-dot";
          if (info.over) cls += " over";
          else if (info.total && info.done === info.total) cls += " doneall";
          dots = '<span class="cal-dots">' + new Array(Math.max(1, n)).fill('<i class="' + cls + '"></i>').join("") + "</span>";
        } else {
          dots = '<span class="cal-dots"></span>';
        }
        const clsx = ["cal-cell", c.out ? "out" : "", c.date === today ? "today" : "", c.date === calState.sel ? "sel" : ""]
          .filter(Boolean)
          .join(" ");
        return '<div class="' + clsx + '" data-act="cal-pick" data-date="' + c.date + '">' + c.day + dots + "</div>";
      })
      .join("") +
    "</div>";

  const head =
    '<div class="cal-head"><div class="cal-title">' + y + " 年 " + m + " 月</div>" +
    '<div class="cal-nav">' +
    '<button class="ico-btn" data-act="cal-today" title="回到今天" style="width:auto;padding:0 11px;font-size:13px">今天</button>' +
    '<button class="ico-btn" data-act="cal-prev" aria-label="上个月">' + SVG.back + "</button>" +
    '<button class="ico-btn" data-act="cal-next" aria-label="下个月">' + SVG.chev + "</button>" +
    "</div></div>";

  const selItems = byDate(calState.sel);
  const selBlock =
    '<div class="sec-title">' + esc(calState.sel === today ? "今天" : fmtDate(calState.sel)) + " · " + selItems.length + " 件</div>" +
    (selItems.length
      ? selItems.map((it) => taskHTML(it)).join("")
      : '<div class="empty" style="padding:26px 12px"><p>这天没有安排</p><p class="em-hint">在上面的格子里点别的日期</p></div>');

  return head + grid + selBlock;
}

export function calSub() {
  const st = stats();
  return "共 " + st.pending + " 件待办未完成";
}
