/* ============================================================
   page-lists.js — 清单页（总览 + 单个清单）
   ============================================================ */

import { lists, pendingOf, allTags, getState } from "./store.js";
import { taskWithSubsHTML, emptyHTML, foldList, foldMoreHTML } from "./render.js";
import { SVG } from "./ui.js";
import { esc, todayYmd } from "./util.js";

export const listState = { openId: null, tag: null };

function overdueCount(items) {
  const t = todayYmd();
  return items.filter((x) => !x.done && x.due && x.due < t).length;
}

/** 清单总览 */
export function listsHTML() {
  const rows = lists()
    .map((l) => {
      const items = pendingOf(l.id);
      const left = items.filter((x) => !x.done).length;
      const over = overdueCount(items);
      const count = over
        ? '<span class="list-count">' + left + " · </span><span class=\"list-count warn\">" + over + " 逾期</span>"
        : '<span class="list-count">' + left + "</span>";
      return (
        '<div class="list-row" data-act="open-list" data-list="' + l.id + '">' +
        '<span class="list-dot" style="background:' + l.color + '"></span>' +
        '<span class="list-name">' + esc(l.name) + "</span>" +
        count +
        '<span class="chev">' + SVG.chev + "</span></div>"
      );
    })
    .join("");

  const addRow =
    '<div class="list-row" data-act="add-list">' +
    '<span class="list-dot" style="background:var(--line-2)"></span>' +
    '<span class="list-name" style="color:var(--ink-3)">新建清单</span>' +
    '<span class="chev">' + SVG.plus + "</span></div>";

  const tags = allTags();
  const tagHTML = tags.length
    ? '<div class="sec-title">标签</div><div class="tag-cloud">' +
      tags
        .map((t) => '<button class="tag-pill" data-act="open-tag" data-tag="' + esc(t.name) + '">' + esc(t.name) + " " + t.cnt + "</button>")
        .join("") +
      "</div>"
    : "";

  return '<div class="sec-title">我的清单</div>' + rows + addRow + tagHTML;
}

/** 单个清单 / 单个标签下的任务 */
export function listDetailHTML() {
  const isTag = !!listState.tag;
  const st = getState();
  let items;
  if (isTag) {
    items = st.items.filter((x) => !x.parentId && (x.tags || []).indexOf(listState.tag) >= 0);
  } else {
    items = pendingOf(listState.openId);
  }
  items = items.slice().sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1));

  const todo = items.filter((x) => !x.done);
  const done = items.filter((x) => x.done);

  if (!items.length) {
    return emptyHTML(
      SVG.note,
      "这里还空着",
      isTag ? "给任务加上「" + listState.tag + "」标签，就会出现在这儿" : "回「今天」页记一条，就会落到对应的清单里"
    );
  }

  const foldKey = isTag ? "tag|" + listState.tag : "list|" + listState.openId;
  const shownTodo = foldList(foldKey, todo);
  let html =
    shownTodo.map((it) => taskWithSubsHTML(it)).join("") +
    foldMoreHTML(foldKey, todo.length, shownTodo.length);
  if (done.length) {
    html +=
      '<div class="sec-title">已完成 ' + done.length + "</div>" +
      done.map((it) => taskWithSubsHTML(it)).join("");
  }
  return html;
}

export function listTitle() {
  if (listState.tag) return listState.tag;
  const l = getState().lists.find((x) => x.id === listState.openId);
  return l ? l.name : "清单";
}

export function listSub() {
  if (listState.tag) return "标签";
  const l = getState().lists.find((x) => x.id === listState.openId);
  if (!l) return "";
  const items = pendingOf(l.id);
  return items.filter((x) => !x.done).length + " 件待办 · 共 " + items.length + " 件";
}
