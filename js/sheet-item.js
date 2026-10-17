/* ============================================================
   sheet-item.js — 任务详情 / 编辑弹层
   改动即时保存（没有"保存"按钮），符合"随手改"的直觉。
   ============================================================ */

import {
  getItem, updateItem, removeItem, subtasksOf, addSubTask, getState,
  putBlob, dropBlob, getBlob, compressImage, allTags, lists,
} from "./store.js";
import { openSheet, closeSheet, confirmBox, toast, SVG } from "./ui.js";
import { esc, uid } from "./util.js";

const REPEAT_OPTS = [
  { v: "", label: "不重复" },
  { v: "daily", label: "每天" },
  { v: "weekdays", label: "工作日" },
  { v: "weekly", label: "每周" },
  { v: "monthly", label: "每月" },
];

const REMIND_OPTS = [
  { v: "off", label: "不提醒" },
  { v: "0", label: "到点" },
  { v: "5", label: "提前5分" },
  { v: "15", label: "提前15分" },
  { v: "30", label: "提前30分" },
  { v: "60", label: "提前1小时" },
];

const CREATED_URLS = [];

function revokeAll() {
  while (CREATED_URLS.length) {
    try { URL.revokeObjectURL(CREATED_URLS.pop()); } catch (e) { /* ignore */ }
  }
}

export function openItemSheet(id) {
  const it = getItem(id);
  if (!it) return;

  const st = getState();
  const body =
    /* 标题 */
    '<div class="field"><input class="input" id="shTitle" placeholder="要做什么？" value="' + esc(it.title) + '"></div>' +
    /* 清单 */
    '<div class="field"><label>放在哪个清单</label><div class="pick-row" id="shLists">' +
    lists()
      .map(
        (l) =>
          '<button class="pick ' + (it.listId === l.id ? "on" : "") + '" data-list="' + l.id + '">' +
          esc(l.icon) + " " + esc(l.name) + "</button>"
      )
      .join("") +
    "</div></div>" +
    /* 日期时间 */
    '<div class="field"><label>什么时候</label><div class="field-2">' +
    '<input class="input" type="date" id="shDue" value="' + (it.due || "") + '">' +
    '<input class="input" type="time" id="shTime" value="' + (it.time || "") + '">' +
    "</div></div>" +
    /* 重复 */
    '<div class="field"><label>重复</label><div class="pick-row" id="shRepeat">' +
    REPEAT_OPTS.map(
      (o) =>
        '<button class="pick ' + (repeatKey(it.repeat) === o.v ? "on" : "") + '" data-rep="' + o.v + '">' + esc(o.label) + "</button>"
    ).join("") +
    "</div></div>" +
    /* 提醒 */
    '<div class="field"><label>提醒</label><div class="pick-row" id="shRemind">' +
    REMIND_OPTS.map(
      (o) =>
        '<button class="pick ' + (remindKey(it) === o.v ? "on" : "") + '" data-rem="' + o.v + '">' + esc(o.label) + "</button>"
    ).join("") +
    "</div></div>" +
    /* 优先级 */
    '<div class="field"><label>重要程度</label><div class="pick-row" id="shPri">' +
    [["0", "普通", ""], ["1", "重要", "p-amber"], ["2", "紧急", "p-red"]]
      .map(
        (o) =>
          '<button class="pick ' + (String(it.priority) === o[0] ? "on " + o[2] : "") + '" data-pri="' + o[0] + '">' + esc(o[1]) + "</button>"
      )
      .join("") +
    "</div></div>" +
    /* 标签 */
    '<div class="field"><label>标签</label>' +
    '<div class="pick-row" id="shTags" style="margin-bottom:8px"></div>' +
    '<input class="input" id="shTagInput" placeholder="打一个标签，回车加上（例：国网）">' +
    "</div>" +
    /* 子任务 */
    '<div class="field"><label>拆成几步</label><div id="shSubs"></div>' +
    '<input class="input" id="shSubInput" placeholder="加一步，回车确认" style="margin-top:7px">' +
    "</div>" +
    /* 图片 */
    '<div class="field"><label>图片</label><div class="img-strip" id="shImgs">' +
    '<button class="img-add" id="shImgAdd">' + SVG.img + "</button>" +
    "</div>" +
    '<input type="file" accept="image/*" id="shFile" class="hidden">' +
    "</div>" +
    /* 备注 */
    '<div class="field"><label>备注</label><textarea class="textarea" id="shNote" placeholder="随手记点什么…">' + esc(it.note) + "</textarea></div>" +
    /* 删除 */
    '<div class="btn-row"><button class="btn danger" id="shDel">删除这条</button></div>';

  const sheet = openSheet({
    title: "这一条",
    body,
    onClose: revokeAll,
  });

  /* ---------- 绑定 ---------- */

  const cur = () => getItem(id);

  const titleInp = sheet.querySelector("#shTitle");
  titleInp.oninput = () => updateItem(id, { title: titleInp.value });

  sheet.querySelector("#shLists").onclick = (e) => {
    const b = e.target.closest("[data-list]");
    if (!b) return;
    updateItem(id, { listId: b.dataset.list });
    sheet.querySelectorAll("#shLists .pick").forEach((x) => x.classList.toggle("on", x === b));
  };

  const dueInp = sheet.querySelector("#shDue");
  const timeInp = sheet.querySelector("#shTime");
  dueInp.onchange = () => updateItem(id, { due: dueInp.value || null });
  timeInp.onchange = () => updateItem(id, { time: timeInp.value || null });

  sheet.querySelector("#shRepeat").onclick = (e) => {
    const b = e.target.closest("[data-rep]");
    if (!b) return;
    const v = b.dataset.rep;
    let rep = null;
    if (v === "daily") rep = { type: "daily", n: 1 };
    else if (v === "weekdays") rep = { type: "weekdays" };
    else if (v === "weekly") rep = { type: "weekly", wd: cur().due ? new Date(cur().due).getDay() : 1 };
    else if (v === "monthly") rep = { type: "monthly", day: cur().due ? Number(cur().due.slice(8, 10)) : null };
    updateItem(id, { repeat: rep });
    sheet.querySelectorAll("#shRepeat .pick").forEach((x) => x.classList.toggle("on", x === b));
    if (rep && !cur().due) toast("已设重复；建议再选个日期");
  };

  sheet.querySelector("#shRemind").onclick = (e) => {
    const b = e.target.closest("[data-rem]");
    if (!b) return;
    const v = b.dataset.rem;
    updateItem(id, { remindAhead: v === "off" ? null : Number(v) });
    sheet.querySelectorAll("#shRemind .pick").forEach((x) => x.classList.toggle("on", x === b));
  };

  sheet.querySelector("#shPri").onclick = (e) => {
    const b = e.target.closest("[data-pri]");
    if (!b) return;
    updateItem(id, { priority: Number(b.dataset.pri) });
    sheet.querySelectorAll("#shPri .pick").forEach((x) => x.classList.toggle("on", x === b));
  };

  /* 标签 */
  const tagsBox = sheet.querySelector("#shTags");
  const tagInput = sheet.querySelector("#shTagInput");
  const known = allTags().map((t) => t.name);

  function renderTags() {
    const mine = cur().tags || [];
    const pool = known.filter((t) => mine.indexOf(t) < 0).slice(0, 6);
    tagsBox.innerHTML =
      mine
        .map((t) => '<button class="pick on" data-tag-off="' + esc(t) + '">#' + esc(t) + " ×</button>")
        .join("") +
      pool.map((t) => '<button class="pick" data-tag-on="' + esc(t) + '">#' + esc(t) + "</button>").join("");
  }
  renderTags();

  tagsBox.onclick = (e) => {
    const off = e.target.closest("[data-tag-off]");
    const on = e.target.closest("[data-tag-on]");
    const t = cur();
    if (off) {
      updateItem(id, { tags: t.tags.filter((x) => x !== off.dataset.tagOff) });
      renderTags();
    } else if (on) {
      updateItem(id, { tags: t.tags.concat([on.dataset.tagOn]) });
      renderTags();
    }
  };
  tagInput.onkeydown = (e) => {
    if (e.key !== "Enter") return;
    const v = tagInput.value.trim().replace(/^#/, "");
    if (!v) return;
    const t = cur();
    if (t.tags.indexOf(v) < 0) updateItem(id, { tags: t.tags.concat([v]) });
    tagInput.value = "";
    if (known.indexOf(v) < 0) known.push(v);
    renderTags();
  };

  /* 子任务 */
  const subsBox = sheet.querySelector("#shSubs");
  const subInput = sheet.querySelector("#shSubInput");
  function renderSubs() {
    const kids = subtasksOf(id);
    subsBox.innerHTML = kids.length
      ? kids
          .map(
            (k) =>
              '<div class="sub-edit"><button class="tick' + (k.done ? " on" : "") + '" data-sub-toggle="' + k.id + '">' +
              (k.done ? SVG.check : "") +
              '</button><span' + (k.done ? ' style="text-decoration:line-through;color:var(--ink-3)"' : "") + ">" +
              esc(k.title) + '</span><button class="del" data-sub-del="' + k.id + '">×</button></div>'
          )
          .join("")
      : '<div class="row-sub" style="padding:2px 2px 0">还没有拆分。想到一步就加一步。</div>';
  }
  renderSubs();

  subsBox.onclick = (e) => {
    const tg = e.target.closest("[data-sub-toggle]");
    const dl = e.target.closest("[data-sub-del]");
    if (tg) {
      const k = getItem(tg.dataset.subToggle);
      if (k) {
        updateItem(k.id, { done: !k.done, doneAt: k.done ? null : Date.now() });
        renderSubs();
      }
    } else if (dl) {
      removeItem(dl.dataset.subDel);
      renderSubs();
    }
  };
  subInput.onkeydown = (e) => {
    if (e.key !== "Enter") return;
    const v = subInput.value.trim();
    if (!v) return;
    addSubTask(id, v);
    subInput.value = "";
    renderSubs();
  };

  /* 图片 */
  const imgsBox = sheet.querySelector("#shImgs");
  const fileInp = sheet.querySelector("#shFile");
  const imgAdd = sheet.querySelector("#shImgAdd");

  async function renderImgs() {
    const list = cur().imgs || [];
    let html = "";
    for (const bid of list) {
      try {
        const blob = await getBlob(bid);
        if (!blob) continue;
        const u = URL.createObjectURL(blob);
        CREATED_URLS.push(u);
        html +=
          '<div class="img-thumb"><img src="' + u + '" alt=""><button class="x" data-img-del="' + bid + '">×</button></div>';
      } catch (e) { /* ignore */ }
    }
    imgsBox.innerHTML = html + '<button class="img-add" id="shImgAdd">' + SVG.img + "</button>";
    imgsBox.querySelector("#shImgAdd").onclick = () => fileInp.click();
  }
  imgAdd.onclick = () => fileInp.click();
  fileInp.onchange = async () => {
    const f = fileInp.files && fileInp.files[0];
    fileInp.value = "";
    if (!f) return;
    try {
      toast("处理图片…");
      const blob = await compressImage(f);
      const bid = uid("b");
      await putBlob(bid, blob);
      const t = cur();
      updateItem(id, { imgs: (t.imgs || []).concat([bid]) });
      revokeAll();
      await renderImgs();
    } catch (e) {
      toast("图片没加上：" + e.message);
    }
  };
  imgsBox.addEventListener("click", (e) => {
    const d = e.target.closest("[data-img-del]");
    if (!d) return;
    const t = cur();
    updateItem(id, { imgs: (t.imgs || []).filter((x) => x !== d.dataset.imgDel) });
    dropBlob(d.dataset.imgDel);
    revokeAll();
    renderImgs();
  });
  renderImgs();

  /* 备注 */
  const noteInp = sheet.querySelector("#shNote");
  noteInp.oninput = () => updateItem(id, { note: noteInp.value });

  /* 删除 */
  sheet.querySelector("#shDel").onclick = async () => {
    const ok = await confirmBox("删掉「" + (cur().title || "这一条") + "」？", "删掉", true);
    if (!ok) return;
    removeItem(id);
    closeSheet();
    toast("已删除");
  };
}

function repeatKey(r) {
  if (!r) return "";
  if (r.type === "daily") return "daily";
  if (r.type === "weekdays") return "weekdays";
  if (r.type === "weekly") return "weekly";
  if (r.type === "monthly") return "monthly";
  return "";
}

/** 提醒那排该亮哪一个（三种状态：没动过 / 明确关掉 / 提前 N 分钟） */
function remindKey(it) {
  if (it.remindAhead === null) return "off";
  if (it.remindAhead === undefined) return it.due ? "0" : "off";
  return String(it.remindAhead);
}
