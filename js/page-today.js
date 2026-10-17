/* ============================================================
   page-today.js — 今天页
   顶部常驻输入框：打一句话就记下。下面按"逾期 / 今天 / 接下来 / 未定"分组。
   ============================================================ */

import { todayBuckets } from "./store.js";
import { emptyHTML, groupHTML, doneFoldHTML } from "./render.js";
import { SVG } from "./ui.js";
import { esc, fmtDate, repeatLabel } from "./util.js";

/** 输入框状态（重渲染后要还原，所以放模块里） */
export const quickState = { value: "", parsed: null, busy: false };

export function quickHTML() {
  return (
    '<div class="composer">' +
    '<input id="quickInput" type="text" enterkeyhint="done" placeholder="记一条…" value="' +
    esc(quickState.value) +
    '" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">' +
    '<button class="send" data-act="qk-submit" aria-label="记下">' + SVG.send + "</button>" +
    "</div>" +
    '<div id="quickChips" class="chips"></div>'
  );
}

/** 解析出来的胶囊（日期 / 时间 / 重复 / 标签 / 清单） */
export function chipsHTML(p) {
  if (!p) return "";
  const chips = [];
  if (p.due) {
    const d = fmtDate(p.due) + (p.time ? " " + p.time : "");
    chips.push('<span class="chip">' + SVG.cal + esc(d) + "</span>");
  } else if (p.time) {
    chips.push('<span class="chip">' + SVG.clock + esc(p.time) + "</span>");
  }
  if (p.repeat) chips.push('<span class="chip chip-repeat">' + SVG.repeat + esc(repeatLabel(p.repeat)) + "</span>");
  const LIST_NAME = { study: "备考任务", life: "生活杂事", long: "长期推进", inbox: "收件箱" };
  if (p.listType) chips.push('<span class="chip chip-list">' + esc(LIST_NAME[p.listType] || p.listType) + "</span>");
  (p.tags || []).forEach((t) => chips.push('<span class="chip chip-tag">#' + esc(t) + "</span>"));
  return chips.join("");
}

export function todayHTML() {
  const { over, todays, soon, noDate } = todayBuckets();
  const doneToday = todays.filter((x) => x.done);
  const todoToday = todays.filter((x) => !x.done);

  let html = quickHTML();

  if (!over.length && !todoToday.length && !soon.length && !noDate.length && !doneToday.length) {
    return (
      html +
      emptyHTML(SVG.spark, "今天还没记东西", "在上面打一句试试：「明天下午三点交高数作业」")
    );
  }

  html += groupHTML("已逾期", over, { cls: "overdue", key: "today|over" });
  html += groupHTML("今天", todoToday, { key: "today|today" });
  html += groupHTML("接下来 7 天", soon, { key: "today|soon" });
  html += groupHTML("还没定日期", noDate, { key: "today|nodate" });
  html += doneFoldHTML(doneToday);
  return html;
}

/** 顶部副标题：今天 x 件待办 · 本周完成 y 件 */
export function todaySub(st) {
  return "待办 " + (st.todayTotal - st.todayDone) + " 件 · 本周完成 " + st.weekDone + " 件";
}
