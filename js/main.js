/* ============================================================
   main.js — 入口：路由、事件、快速记、提醒检查
   ============================================================ */

import {
  init, subscribe, addItem, updateItem, removeItem, toggleItem, getItem,
  prefs, setPref, stats, exportJSON, importJSON, exportBackup, importBackup, clearDone, wipe,
  lists, addList, removeList, allItems, searchItems, todayBuckets, byDate,
} from "./store.js";
import { parseNatural, fmtDate, esc, download, buildICS, todayYmd, diffDays, uid, repeatLabel } from "./util.js";
import { toast, openSheet, closeSheet, confirmBox, promptBox, pickBox, undoToast, SVG } from "./ui.js";
import { taskHTML, foldState } from "./render.js";
import { todayHTML, chipsHTML, quickState, todaySub } from "./page-today.js";
import { listsHTML, listDetailHTML, listState, listTitle, listSub } from "./page-lists.js";
import { calHTML, calState, initCal, calSub } from "./page-calendar.js";
import { meHTML, meSub } from "./page-me.js";
import { openItemSheet } from "./sheet-item.js";
import * as push from "./push.js";
import * as cloud from "./cloud-backup.js";

const view = document.getElementById("view");
const titleEl = document.getElementById("pageTitle");
const subEl = document.getElementById("pageSub");
let tab = "today";
let renderLock = 0;

init();
initCal();

/* ============================================================
   渲染
   ============================================================ */

function render(opts = {}) {
  const keepTop = view.scrollTop;
  const st = stats();
  let html = "";

  if (tab === "today") {
    titleEl.textContent = "今天";
    subEl.textContent = todaySub(st);
    html = todayHTML();
  } else if (tab === "lists") {
    if (listState.openId || listState.tag) {
      titleEl.textContent = listTitle();
      subEl.textContent = listSub();
      html =
        '<button class="row" data-act="back-lists" style="border-bottom:1px solid var(--line)">' +
        '<span class="row-arrow">' + SVG.back + "</span>" +
        '<div class="row-main"><div class="row-title">所有清单</div></div></button>' +
        '<div style="height:16px"></div>' +
        listDetailHTML();
    } else {
      titleEl.textContent = "清单";
      subEl.textContent = lists().length + " 个清单 · " + st.pending + " 件未完成";
      html = listsHTML();
    }
  } else if (tab === "calendar") {
    titleEl.textContent = "日历";
    subEl.textContent = calSub();
    html = calHTML();
  } else {
    titleEl.textContent = "我的";
    subEl.textContent = meSub();
    html = meHTML();
  }

  view.innerHTML = html;

  if (tab === "today") bindQuick();
  view.scrollTop = opts.toTop ? 0 : keepTop;
}

function setTab(t) {
  if (tab === t) {
    view.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  tab = t;
  if (t === "calendar" && !calState.ym) initCal();
  document.querySelectorAll("#tabbar .tab").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
  render({ toTop: true });
}

/* ============================================================
   快速记一条
   ============================================================ */

function bindQuick() {
  const inp = document.getElementById("quickInput");
  if (!inp) return;
  inp.oninput = () => {
    quickState.value = inp.value;
    const box = document.getElementById("quickChips");
    const p = inp.value.trim() ? parseNatural(inp.value) : null;
    quickState.parsed = p;
    if (box) box.innerHTML = chipsHTML(p);
  };
  inp.onkeydown = (e) => {
    // 拼音/五笔打字时按回车是"选词"，不是"提交"。
    // 不判这一下，打一半就会被记成任务（keyCode 229 是部分安卓输入法的特征值）。
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter") {
      e.preventDefault();
      submitQuick();
    }
  };
  if (quickState.value) {
    const v = inp.value;
    inp.focus();
    try { inp.setSelectionRange(v.length, v.length); } catch (e) { /* ignore */ }
  }
}

function listIdByType(type) {
  const l = lists().find((x) => x.type === type);
  return l ? l.id : null;
}

function mergeAI(local, ai) {
  const out = Object.assign({}, local);
  if (ai.title) out.title = ai.title;
  if (ai.due) out.due = ai.due;
  if (ai.time) out.time = ai.time;
  if (ai.priority != null && ai.priority > (out.priority || 0)) out.priority = ai.priority;
  if (Array.isArray(ai.tags) && ai.tags.length) {
    const set = out.tags.slice();
    ai.tags.forEach((t) => { if (set.indexOf(t) < 0) set.push(t); });
    out.tags = set;
  }
  if (ai.repeat && !out.repeat) out.repeat = ai.repeat;
  if (ai.listType && !out.listType) out.listType = ai.listType;
  return out;
}

async function submitQuick() {
  const inp = document.getElementById("quickInput");
  const raw = ((inp && inp.value) || "").trim();
  if (!raw) return;

  const pf = prefs();

  // 先落地：本机解析是毫秒级的，不能为了等云端让"记一件事"卡两三秒。
  // AI 有用的话在后台补全（见 refineWithAI），补不上也不影响这条已经记下了。
  const p = parseNatural(raw);
  if (!p.title) {
    toast("要做什么？再写两个字");
    return;
  }

  const listId = listIdByType(p.listType) || pf.defaultListId || "l_inbox";
  const it = addItem({
    title: p.title, due: p.due, time: p.time, repeat: p.repeat,
    priority: p.priority, tags: p.tags, listId,
  });

  // 记下"我放进去的原始样子"，等云端回来时用它判断他有没有自己动过
  const before = {
    title: it.title, due: it.due, time: it.time, repeat: it.repeat,
    priority: it.priority, tags: (it.tags || []).join(","),
  };

  quickState.value = "";
  quickState.parsed = null;
  if (inp) inp.value = "";
  const box = document.getElementById("quickChips");
  if (box) box.innerHTML = "";
  render();

  const when = p.due ? fmtDate(p.due) + (p.time ? " " + p.time : "") : "";
  toast(when ? "记下了 · " + when : "记下了");
  if (inp) inp.focus();

  // 只有本机没读出日期/重复时，才值得让云端再看一眼
  // （「明天下午三点」「每天」这种本机就认得，没必要多跑一趟，也省额度）
  const worthAI = !p.due && !p.repeat;
  if (worthAI && pf.aiOn && pf.aiUrl) refineWithAI(it.id, raw, before);
}

/** 云端听懂了就在后台把这条改准（不等它、不挡着记录，他改过就不动） */
async function refineWithAI(id, raw, before) {
  let ai = null;
  try {
    ai = await callAI(raw);
  } catch (e) {
    return; // 没连上就算了，任务已经记下了
  }
  if (!ai) return;

  const it = getItem(id);
  if (!it || it.done || it.parentId) return; // 已删 / 已打勾 / 变成子任务

  const same =
    it.title === before.title &&
    it.due === before.due &&
    it.time === before.time &&
    JSON.stringify(it.repeat || null) === JSON.stringify(before.repeat || null) &&
    it.priority === before.priority &&
    (it.tags || []).join(",") === before.tags;
  if (!same) return; // 这几秒里他自己改过了，以他为准

  const m = mergeAI(
    { title: it.title, due: it.due, time: it.time, repeat: it.repeat, priority: it.priority, tags: (it.tags || []).slice(), listType: null },
    ai
  );

  const patch = {};
  if (m.title && m.title !== it.title) patch.title = m.title;
  if (m.due !== it.due) patch.due = m.due || null;
  if (m.time !== it.time) patch.time = m.time || null;
  if (JSON.stringify(m.repeat || null) !== JSON.stringify(it.repeat || null)) patch.repeat = m.repeat || null;
  if (m.priority > it.priority) patch.priority = m.priority;
  if (m.tags.length !== (it.tags || []).length) patch.tags = m.tags;

  // 顺手归档：但只在他没盯着某个清单看的时候做，
  // 否则任务会从他眼前"跳走"，比放错清单更让人迷惑。
  const lid = ai.listType ? listIdByType(ai.listType) : null;
  if (lid && lid !== it.listId && it.listId === (prefs().defaultListId || "l_inbox") && !listState.openId && !listState.tag) {
    patch.listId = lid;
  }

  if (!Object.keys(patch).length) return;

  updateItem(id, patch);
  render();

  const bits = [];
  if (patch.due) bits.push(fmtDate(patch.due));
  if (patch.time) bits.push(patch.time);
  if (patch.repeat) bits.push("会重复");
  if (patch.title) bits.push("“" + patch.title + "”");
  if (patch.listId) {
    const L = lists().find((x) => x.id === patch.listId);
    if (L) bits.push("归到" + L.name);
  }
  toast(bits.length ? "云端看明白了 · " + bits.join(" ") : "云端补全了", 2200);
}

/** 调用云端 AI（默认走云函数内置通道，前端不用配；连不上就让本机解析兜底） */
async function callAI(text) {
  const pf = prefs();
  if (!pf.aiUrl) return null;
  const body = {
    action: "parse",
    text,
    today: todayYmd(),
  };
  // 只有他自己配过密钥/换了模型才带上，否则让云函数用内置的
  if (pf.aiKey) body.apiKey = pf.aiKey;
  if (pf.aiKey && pf.aiBase) body.base = pf.aiBase;
  if (pf.aiKey && pf.aiModel) body.model = pf.aiModel;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch(pf.aiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const txt = await r.text();
    let d;
    try {
      d = JSON.parse(txt);
    } catch (e) {
      throw new Error("返回内容看不懂");
    }
    // 云函数走"集成响应"时，真正的数据可能裹在 body 字段里
    if (d && typeof d.body === "string") {
      try { d = JSON.parse(d.body); } catch (e) { /* 保持原样 */ }
    }
    if (!d || d.ok === false) throw new Error((d && d.error) || "AI 返回异常");
    return d.task || null;
  } finally {
    clearTimeout(timer);
  }
}

/* 常用模型（换服务商时地址要跟着换） */
const AI_BASES = {
  builtin: "https://api.seventoken.shop/v1",
  dashscope: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  deepseek: "https://api.deepseek.com",
  moonshot: "https://api.moonshot.cn/v1",
  zhipu: "https://open.bigmodel.cn/api/paas/v4",
};

const AI_PRESETS = [
  { label: "用内置的（推荐）", value: "builtin|gemini-3.8-flash", hint: "不用填密钥，已经配好了" },
  { label: "内置 · 更稳一档", value: "builtin|gemini-4-argon-medium", hint: "绕的说法也不容易听错，稍慢一点" },
  { label: "阿里百炼 · qwen-plus", value: "dashscope|qwen-plus", hint: "要用你自己的密钥" },
  { label: "DeepSeek · deepseek-chat", value: "deepseek|deepseek-chat", hint: "要用你自己的密钥" },
  { label: "月之暗面 · moonshot-v1-8k", value: "moonshot|moonshot-v1-8k", hint: "要用你自己的密钥" },
  { label: "智谱 · glm-4-flash", value: "zhipu|glm-4-flash", hint: "要用你自己的密钥" },
  { label: "自定义…", value: "__custom__", hint: "自己填服务地址和模型名" },
];

function baseKeyOf(base) {
  for (const k of Object.keys(AI_BASES)) if (AI_BASES[k] === base) return k;
  return "";
}

/* ============================================================
   事件
   ============================================================ */

document.getElementById("tabbar").addEventListener("click", (e) => {
  const b = e.target.closest(".tab");
  if (b) setTab(b.dataset.tab);
});

view.addEventListener("click", async (e) => {
  /* 打勾 */
  const tick = e.target.closest('[data-act="toggle"]');
  if (tick) {
    const t = tick.closest(".task");
    if (t) { doToggle(t.dataset.id); return; }
  }

  const el = e.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act;

  switch (act) {
    case "open":
    case "open-task": {
      const t = el.closest(".task");
      if (t) openItemSheet(t.dataset.id);
      break;
    }
    case "qk-submit":
      submitQuick();
      break;
    case "fold-open":
      // 长列表："还有 N 条"点开，只影响这一组
      if (el.dataset.fold) {
        foldState.add(el.dataset.fold);
        render();
      }
      break;
    case "open-list":
      listState.openId = el.dataset.list;
      listState.tag = null;
      render({ toTop: true });
      break;
    case "open-tag":
      listState.tag = el.dataset.tag;
      listState.openId = null;
      render({ toTop: true });
      break;
    case "back-lists":
      listState.openId = null;
      listState.tag = null;
      render({ toTop: true });
      break;
    case "add-list":
      await doAddList();
      break;
    case "cal-prev": {
      const [y, m] = calState.ym.split("-").map(Number);
      const d = new Date(y, m - 2, 1);
      calState.ym = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
      render();
      break;
    }
    case "cal-next": {
      const [y, m] = calState.ym.split("-").map(Number);
      const d = new Date(y, m, 1);
      calState.ym = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
      render();
      break;
    }
    case "cal-today":
      calState.sel = todayYmd();
      calState.ym = calState.sel.slice(0, 7);
      render();
      break;
    case "cal-pick":
      calState.sel = el.dataset.date;
      calState.ym = calState.sel.slice(0, 7);
      render();
      break;
    case "toggle-ai":
      setPref("aiOn", !prefs().aiOn);
      render();
      toast(prefs().aiOn ? "AI 智能输入已开启" : "已关闭，只用本机解析");
      break;
    case "set-aikey":
      await doSetAiKey();
      break;
    case "set-aimodel":
      await doSetAiModel();
      break;
    case "test-ai":
      await doTestAi();
      break;
    case "toggle-remind":
      setPref("remindOn", !prefs().remindOn);
      render();
      break;
    case "toggle-push":
      await doTogglePush();
      break;
    case "test-push":
      await doTestPush();
      break;
    case "toggle-brief":
      setPref("dailyBriefOn", !prefs().dailyBriefOn);
      render();
      break;
    case "toggle-inboxclean":
      setPref("inboxCleanOn", !prefs().inboxCleanOn);
      render();
      break;
    case "set-cleantime":
      await doSetCleanTime();
      break;
    case "export-ics":
      doExportICS();
      break;
    case "export-json":
      doExportBackup();
      break;
    case "import-json":
      doImportJSON();
      break;
    case "cloud-save":
      await doCloudSave();
      break;
    case "cloud-load":
      await doCloudLoad();
      break;
    case "backup-key":
      await doBackupKey();
      break;
    case "clear-done":
      await doClearDone();
      break;
    case "how-install":
      howInstall();
      break;
    case "how-syntax":
      howSyntax();
      break;
  }
});

function doToggle(id) {
  const it = getItem(id);
  if (!it) return;
  const wasDone = it.done;
  const r = toggleItem(id);

  if (!wasDone) {
    const label = (it.title || "").slice(0, 12);
    undoToast("完成：" + label, () => {
      if (r && r.spawned) removeItem(r.spawned.id);
      toggleItem(id);
      render();
    });
    if (r && r.spawned) toast("重复任务：下一次已排到 " + fmtDate(r.spawned.due), 2400);
  }
  render();
}

async function doAddList() {
  const name = await promptBox("新清单叫什么？", "", "例：杂事 / 网购 / 实验报告");
  if (!name) return;
  const icons = ["📌", "📗", "🛒", "🧪", "🎯", "💡", "🏠"];
  addList({ name, icon: icons[Math.floor(Math.random() * icons.length)] });
  render();
  toast("建好了");
}

async function doSetAiKey() {
  const v = await promptBox("用我自己的密钥（可选）", prefs().aiKey, "不填就用内置的，不用管这里", {
    type: "password",
    hint: "默认已经配好了，这一步完全不用做。只有你想换成自己申请的密钥时才填：只存在这台设备上，不上传。",
  });
  if (v === null) return;
  setPref("aiKey", v);
  render();
  toast(v ? "密钥已保存" : "已清空，改回用内置的");
}

async function doSetAiModel() {
  const cur = baseKeyOf(prefs().aiBase) + "|" + (prefs().aiModel || "");
  const v = await pickBox("用哪个模型", AI_PRESETS, cur);
  if (!v) return;

  if (v === "__custom__") {
    const base = await promptBox("模型服务地址", prefs().aiBase, "https://…", {
      hint: "要写到版本号那一层，比如 https://dashscope.aliyuncs.com/compatible-mode/v1",
    });
    if (!base) return;
    const model = await promptBox("模型名", prefs().aiModel, "比如 qwen-plus");
    if (!model) return;
    setPref("aiBase", base);
    setPref("aiModel", model);
    await askKeyIfNeeded();
  } else {
    const parts = v.split("|");
    setPref("aiBase", AI_BASES[parts[0]] || prefs().aiBase);
    setPref("aiModel", parts[1] || prefs().aiModel);
    // 选回内置通道时把自己的密钥清掉，否则会拿别人的钥匙去开内置的门
    if (parts[0] === "builtin" && prefs().aiKey) setPref("aiKey", "");
    else await askKeyIfNeeded();
  }
  render();
  toast("换好了");
}

/** 换成外部服务商时才需要密钥；内置通道不问 */
async function askKeyIfNeeded() {
  const pf = prefs();
  if (baseKeyOf(pf.aiBase) === "builtin") return;
  if (pf.aiKey) return;
  const k = await promptBox("这个模型要你自己的密钥", "", "粘贴密钥", {
    type: "password",
    hint: "只存在这台设备上。不想弄就返回，用「内置的」那两档，不用填。",
  });
  if (k) setPref("aiKey", k);
}

async function doTestAi() {
  toast("正在试…", 3000);
  const sentence = "下周找个时间把实验报告交了";
  const t0 = Date.now();
  let task = null;
  let err = null;
  try {
    task = await callAI(sentence);
    if (!task) err = "云函数没返回结果";
  } catch (e) {
    err = (e && e.message) || String(e);
  }
  const ms = Date.now() - t0;

  if (err) {
    openSheet({
      title: "没通",
      body:
        '<div class="row-sub" style="font-size:14px;line-height:1.8;color:var(--red)">' + esc(err) + "</div>" +
        '<div class="row-sub" style="margin-top:16px;line-height:1.8">' +
        "常见原因：手机这会儿没网、云端打了盹、或者你把模型换成了需要自己密钥的那种。<br>" +
        "这些都不影响软件本身 —— 它会自动用本机解析，照样能记。" +
        "</div>" +
        '<div style="margin-top:18px"><button class="btn" data-x="ok">知道了</button></div>',
      onMount(el) {
        el.querySelector('[data-x="ok"]').onclick = () => closeSheet();
      },
    });
    return;
  }

  const where = { study: "备考任务", life: "生活杂事", long: "长期推进", inbox: "收件箱" };
  const rows = [
    ["理解成", task.title || "（空）"],
    ["日期", task.due || "没定"],
    ["时间", task.time || "没定"],
    ["重复", task.repeat ? repeatLabel(task.repeat) : "不重复"],
    ["放哪儿", where[task.listType] || "收件箱"],
  ];

  openSheet({
    title: "通了",
    hint: ms + " 毫秒",
    body:
      '<div class="row-sub" style="margin-bottom:14px">原话：' + esc(sentence) + "</div>" +
      '<div style="font-size:14.5px;line-height:2.15">' +
      rows
        .map(
          (r) =>
            '<div><b style="display:inline-block;min-width:68px;color:var(--ink-3);font-weight:500">' +
            r[0] +
            "</b>" +
            esc(r[1]) +
            "</div>"
        )
        .join("") +
      "</div>" +
      '<div style="margin-top:20px"><button class="btn" data-x="ok">好</button></div>',
    onMount(el) {
      el.querySelector('[data-x="ok"]').onclick = () => closeSheet();
    },
  });
}

async function doSetCleanTime() {
  const v = await promptBox("几点提醒你清理收件箱？", prefs().inboxCleanTime, "格式 21:00");
  if (v === null) return;
  if (!/^\d{1,2}:\d{2}$/.test(v)) { toast("格式不对，要像 21:00 这样"); return; }
  setPref("inboxCleanTime", v);
  render();
}

/* ============================================================
   云端提醒（关掉软件也能到点弹通知）
   ============================================================ */

async function doTogglePush() {
  if (prefs().pushOn) {
    await push.disable();
    render();
    toast("云端提醒已关 —— 只在打开软件时提醒");
    return;
  }

  if (!push.supported()) {
    toast("这台设备的浏览器不支持系统通知", 3400);
    howInstall();
    return;
  }

  // iPhone 必须先从桌面图标打开，否则系统根本不给通知权限
  if (push.isIOS() && !push.standalone()) {
    const go = await confirmBox(
      "iPhone 上得先把这个软件「添加到主屏幕」，再从桌面图标打开，才能收通知。现在看怎么装？",
      "看怎么装",
      true
    );
    if (go) howInstall();
    return;
  }

  if (push.permission() === "denied") {
    const go = await confirmBox(
      "通知权限现在是「禁止」的，云端推过来也弹不出来。要去手机的 设置 → 通知 里允许它。还是先试一次？",
      "试一次",
      false
    );
    if (!go) return;
  }

  toast("正在把提醒交给云端…", 5000);
  try {
    const r = await push.enable();
    render();
    const n = (r && r.items) || 0;
    toast(n ? "云端提醒已开 · " + n + " 条会到点叫你" : "云端提醒已开（还没有设了提醒的待办）", 4000);
  } catch (e) {
    render();
    toast("没开成：" + ((e && e.message) || e), 4600);
  }
}

async function doTestPush() {
  toast("正在让云端推一条…", 5000);
  let r = null;
  let err = null;
  try {
    r = await push.sendTest();
  } catch (e) {
    err = (e && e.message) || String(e);
  }

  if (err) {
    openSheet({
      title: "没推成",
      body:
        '<div class="row-sub" style="font-size:14px;line-height:1.85;color:var(--red)">' + esc(err) + "</div>" +
        '<div class="row-sub" style="margin-top:14px;line-height:1.8">' +
        "常见原因：这台设备还没登记成功、或者网络连不上推送服务。<br>把开关关掉再打开一次，通常就好了。" +
        "</div>" +
        '<div style="margin-top:18px"><button class="btn" data-x="ok">知道了</button></div>',
      onMount(el) {
        el.querySelector('[data-x="ok"]').onclick = () => closeSheet();
      },
    });
    return;
  }

  const sent = (r && r.sent) || 0;
  const total = (r && r.total) || 0;
  const rows = ((r && r.results) || [])
    .map((x) => {
      const okMark = x.ok ? "推成功" : "被拒" + (x.status ? "（" + x.status + "）" : "");
      return "<div>· 尾号 " + esc(x.tail || "?") + "　" + okMark + (x.error ? "<br><span style=\"color:var(--ink-3)\">" + esc(String(x.error).slice(0, 90)) + "</span>" : "") + "</div>";
    })
    .join("");

  openSheet({
    title: sent ? "推出去了一条" : "没能推出去",
    hint: sent + " / " + total,
    body: sent
      ? '<p class="row-sub" style="font-size:14px;line-height:1.85;color:var(--ink-2);margin:0 0 14px">' +
        "几秒内手机应该弹一条「测试通知：这条路通了」。<br><br>没看到的话按顺序查：<br>" +
        "1. 手机上是不是开了「专注 / 勿扰」<br>" +
        "2. 系统设置里这个软件的通知是不是被关掉了<br>" +
        "3. iPhone 上是不是没从桌面图标打开（必须从图标进）</p>" +
        '<div class="row-sub" style="font-size:13px;line-height:1.7">' + rows + "</div>" +
        '<div style="margin-top:18px"><button class="btn" data-x="ok">好</button></div>'
      : '<p class="row-sub" style="font-size:14px;line-height:1.85;color:var(--ink-2);margin:0 0 14px">' +
        "云端记着这个设备的 " + total + " 个订阅，但推送服务都拒绝了。把开关关掉再打开一次通常能修好。</p>" +
        '<div class="row-sub" style="font-size:13px;line-height:1.7">' + rows + "</div>" +
        '<div style="margin-top:18px"><button class="btn" data-x="ok">知道了</button></div>',
    onMount(el) {
      el.querySelector('[data-x="ok"]').onclick = () => closeSheet();
    },
  });
}

function doExportICS() {
  const items = allItems().filter((x) => !x.done && !x.parentId && x.due);
  if (!items.length) { toast("还没有带日期的待办，先记几条带日期的"); return; }
  const ics = buildICS(items, { alarmMin: prefs().exportAlarmMin });
  download("待办-日历-" + todayYmd() + ".ics", ics, "text/calendar;charset=utf-8");
  openSheet({
    title: "日历文件已生成",
    body:
      '<p class="row-sub" style="font-size:14px;line-height:1.75;color:var(--ink-2);margin:0 0 14px">' +
      "文件里有 <b>" + items.length + "</b> 条带日期的待办。把它存到手机里点开，用「日历」打开并选择加入，之后到点系统闹钟就会叫你 —— 这条路最稳。<br><br>" +
      "注意：以后新增的待办不会自动进日历，需要时再导一次。</p>" +
      '<button class="btn" data-x="ok">知道了</button>',
    onMount(el) {
      el.querySelector('[data-x="ok"]').onclick = () => closeSheet();
    },
  });
}

/** 打包备份：文字 + 图片，一个文件带走 */
async function doExportBackup() {
  toast("正在打包…", 4000);
  try {
    const r = await exportBackup();
    const kb = Math.round(r.json.length / 1024);
    download("待办备份-" + todayYmd() + ".json", r.json, "application/json");
    toast(
      r.images
        ? "已保存 · " + r.images + " 张图，" + (kb > 1024 ? (kb / 1024).toFixed(1) + " MB" : kb + " KB")
        : "已保存 · 没有图片附件",
      3200
    );
  } catch (e) {
    toast("打包失败：" + (e.message || e));
  }
}

function doImportJSON() {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = ".json,application/json";
  inp.onchange = async () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    const ok = await confirmBox("恢复会覆盖现在手机上的数据，确定吗？", "确定恢复", true);
    if (!ok) return;
    try {
      const txt = await f.text();
      const r = await importBackup(txt);
      render({ toTop: true });
      toast("恢复成功 · " + r.items + " 条" + (r.images ? "、" + r.images + " 张图" : ""), 3200);
    } catch (e) {
      toast("读不了这个文件：" + e.message);
    }
  };
  inp.click();
}

/* ---------- 云端备份 ---------- */

async function doCloudSave() {
  toast("正在打包…", 6000);
  try {
    const r = await cloud.save(({ done, total, phase }) => {
      if (phase === "img" && total) toast("正在传图片 " + Math.min(done + 1, total) + "/" + total, 5000);
      else if (phase === "text") toast("正在写备份…", 5000);
    });
    render();
    const tail = r.failed ? "（" + r.failed + " 张没传上去）" : "";
    toast("已备份到云端 · " + r.items + " 条" + (r.images ? "、" + r.images + " 张图" : "") + tail, 3600);
  } catch (e) {
    toast("备份没成功：" + (e.message || e), 3600);
  }
}

async function doCloudLoad() {
  let key = "";
  try {
    key = cloud.backupKey();
  } catch (e) { /* 没生成过就先留空 */ }

  // 先问云端有没有 —— 本机没备份过、或者这是台新手机，都得让他填旧码
  try {
    const info = await cloud.info(key);
    if (!info.exists) {
      const typed = await promptBox("云端还没有这台设备的备份", "", "填之前那台的备份码", {
        hint: "旧手机「我的 → 备份码」里那串字符。两个手机都用同一个码，就能拿到同一份备份。",
        okText: "用这个码找",
      });
      if (!typed) return;
      if (!cloud.validKey(typed)) { toast("备份码格式不对（6~48 位字母数字）"); return; }
      key = typed.trim();
      const again = await cloud.info(key);
      if (!again.exists) { toast("云端没找到这个码的备份"); return; }
    }
  } catch (e) {
    toast("连不上云端：" + (e.message || e), 3600);
    return;
  }

  const sure = await confirmBox("会用云端的备份覆盖现在手机上的任务和图片，确定吗？", "确定恢复", true);
  if (!sure) return;

  try {
    const r = await cloud.load(key, ({ done, total }) => {
      if (total) toast("正在取回图片 " + Math.min(done + 1, total) + "/" + total, 5000);
    });
    render({ toTop: true });
    const tail = r.failed ? "（" + r.failed + " 张图没取回）" : "";
    toast("已恢复 · " + r.items + " 条" + (r.images ? "、" + r.images + " 张图" : "") + tail, 3600);
  } catch (e) {
    toast("恢复失败：" + (e.message || e), 3600);
  }
}

async function doBackupKey() {
  const cur = prefs().backupKey || cloud.backupKey();
  const v = await promptBox("备份码（钥匙）", cur, "6~48 位字母数字", {
    hint: "云端按这个码存你那份备份。换手机、或者手机被清空时，填一样的码就能取回来 —— 建议截图存一份。想改成自己好记的也行，改完记得也记一下。",
    okText: "保存并复制",
  });
  if (v === null) return;
  const s = String(v).trim();
  if (!cloud.validKey(s)) { toast("格式不对：6~48 位，只能用字母、数字、下划线、短横"); return; }
  cloud.setBackupKey(s);
  render();
  const copied = await copyText(s);
  toast(copied ? "备份码已复制 · " + s : "备份码： " + s, 4000);
}

/** 复制到剪贴板；不行就返回 false（调用方改成直接把字显示出来） */
async function copyText(s) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(s);
      return true;
    }
  } catch (e) { /* 没给权限，退回旧办法 */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = s;
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return !!ok;
  } catch (e) {
    return false;
  }
}

async function doClearDone() {
  const n = allItems().filter((x) => x.done).length;
  if (!n) { toast("没有已完成的"); return; }
  const ok = await confirmBox("把 " + n + " 条已完成的收走？", "收走");
  if (!ok) return;
  clearDone();
  render();
  toast("收走了 " + n + " 条");
}

function howInstall() {
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const steps = isIOS
    ? ["用 <b>Safari</b> 打开这个页面（不能用微信里的浏览器）", "点屏幕底部的 <b>分享</b> 按钮（方框加箭头）", "往下滑，选 <b>「添加到主屏幕」</b>", "给它起个名字，点「添加」", "以后从桌面图标打开，才能收到提醒通知"]
    : ["用 <b>Chrome</b> 打开这个页面", "点右上角的 <b>三个点</b>", "选 <b>「添加到主屏幕」/「安装应用」</b>", "确认后，桌面就有了图标"];
  openSheet({
    title: "装到手机主屏幕",
    body:
      '<p class="row-sub" style="font-size:14px;line-height:1.7;color:var(--ink-2);margin:0 0 12px">' +
      "装到桌面之后，点图标就能秒开，不用每次找浏览器；而且只有装了之后，手机才允许这个软件弹提醒。</p>" +
      '<div style="font-size:14.5px;line-height:2.1">' +
      steps.map((s, i) => '<div><b style="color:var(--pink)">' + (i + 1) + ".</b> " + s + "</div>").join("") +
      "</div>" +
      '<div style="margin-top:16px"><button class="btn" data-x="ok">知道了</button></div>',
    onMount(el) {
      el.querySelector('[data-x="ok"]').onclick = () => closeSheet();
    },
  });
}

function howSyntax() {
  openSheet({
    title: "记事的写法",
    body:
      '<p class="row-sub" style="font-size:13.5px;line-height:1.7;color:var(--ink-2);margin:0 0 12px">' +
      "在输入框里直接打一句话就行，日期时间会自动认出来。下面这些都能认：</p>" +
      '<div style="font-size:14px;line-height:2">' +
      [
        ["日期", "今天 / 明天 / 后天 / 大后天 / 3天后"],
        ["星期", "周三 / 下周一 / 下下周五"],
        ["具体日子", "6月3日 / 6/3"],
        ["时间", "下午三点 / 15:00 / 晚上8点半"],
        ["重复", "每天 / 每周三 / 每月15号 / 工作日"],
        ["标签", "#国网 #快递"],
        ["优先级", "!（重要）  !!（紧急）"],
      ]
        .map((r) => '<div><b style="display:inline-block;min-width:74px;color:var(--ink-2)">' + r[0] + "</b>" + esc(r[1]) + "</div>")
        .join("") +
      "</div>" +
      '<div class="row-sub" style="margin-top:14px;font-size:13px;line-height:1.7">例如：<b>明天下午三点交高数作业 #备考</b> → 自动记成「交高数作业」，排到明天 15:00，放进备考清单。</div>' +
      '<div style="margin-top:16px"><button class="btn" data-x="ok">知道了</button></div>',
    onMount(el) {
      el.querySelector('[data-x="ok"]').onclick = () => closeSheet();
    },
  });
}

/* ============================================================
   搜索
   ============================================================ */

const searchWrap = document.getElementById("searchWrap");
const searchInput = document.getElementById("searchInput");
const searchBody = document.getElementById("searchBody");

document.getElementById("btnSearch").onclick = () => {
  searchWrap.classList.remove("hidden");
  searchBody.innerHTML = '<div class="empty"><p>打几个字，把记过的翻出来</p></div>';
  setTimeout(() => searchInput.focus(), 80);
};
document.getElementById("searchClose").onclick = () => {
  searchWrap.classList.add("hidden");
  searchInput.value = "";
};
searchInput.oninput = () => {
  const q = searchInput.value.trim();
  if (!q) {
    searchBody.innerHTML = '<div class="empty" style="padding-top:56px"><p>打几个字，把记过的翻出来</p></div>';
    return;
  }
  const res = searchItems(q);
  if (res.length) {
    const ls = lists();
    searchBody.innerHTML = res
      .map((it) => {
        const l = ls.find((x) => x.id === it.listId);
        return taskHTML(it, { listName: l ? l.name : "" });
      })
      .join("");
  } else {
    searchBody.innerHTML = '<div class="empty" style="padding-top:56px"><p>没找到「' + esc(q) + "」</p></div>";
  }
};
searchBody.addEventListener("click", (e) => {
  const tick = e.target.closest('[data-act="toggle"]');
  if (tick) {
    const t = tick.closest(".task");
    if (t) { doToggle(t.dataset.id); searchInput.dispatchEvent(new Event("input")); }
    return;
  }
  const el = e.target.closest("[data-act]");
  if (el && el.dataset.act === "open") {
    const t = el.closest(".task");
    if (t) openItemSheet(t.dataset.id);
  }
});

/* ============================================================
   打开时的提醒检查
   ============================================================ */

function notifyLocal(title, body) {
  if (!("Notification" in window)) return false;
  if (Notification.permission !== "granted") return false;
  try {
    const n = new Notification(title, { body, icon: "icons/icon-192.png", tag: "daiban" });
    n.onclick = () => { window.focus(); n.close(); };
    return true;
  } catch (e) {
    return false;
  }
}

function checkOnOpen() {
  const p = prefs();
  const t = todayYmd();

  /* --- 每天早上汇总 --- */
  if (p.dailyBriefOn && p.lastBrief !== t) {
    const b = todayBuckets();
    const items = b.over.concat(b.todays.filter((x) => !x.done));
    if (items.length) {
      const list = items
        .slice(0, 6)
        .map((it) => "· " + esc(it.title) + (it.time ? " <span style=\"color:var(--ink-3)\">" + it.time + "</span>" : ""))
        .join("<br>");
      openSheet({
        title: "今天要做这些",
        hint: items.length + " 件",
        body:
          '<div style="font-size:14.5px;line-height:2;margin-bottom:6px">' + list + "</div>" +
          (items.length > 6 ? '<div class="row-sub">……还有 ' + (items.length - 6) + " 件</div>" : "") +
          (b.over.length ? '<div class="row-sub" style="color:var(--red);margin-top:10px">其中 ' + b.over.length + " 件已经逾期了</div>" : "") +
          '<div style="margin-top:16px"><button class="btn" data-x="ok">开工</button></div>',
        onMount(el) {
          el.querySelector('[data-x="ok"]').onclick = () => closeSheet();
        },
      });
      notifyLocal("今天 " + items.length + " 件事", items.slice(0, 3).map((x) => x.title).join(" / "));
    }
    setPref("lastBrief", t);
  }

  /* --- 收件箱清理 --- */
  if (p.inboxCleanOn && p.lastInboxClean !== t) {
    const now = new Date();
    const hm = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
    if (hm >= (p.inboxCleanTime || "21:00")) {
      const inbox = lists().find((x) => x.type === "inbox");
      const n = inbox ? allItems().filter((x) => x.listId === inbox.id && !x.done && !x.parentId).length : 0;
      if (n) {
        toast("收件箱里堆了 " + n + " 条，点「清单」去理一理", 3200);
        notifyLocal("收件箱该清了", n + " 条没处理");
      }
      setPref("lastInboxClean", t);
    }
  }

  /* --- 到期提醒 --- */
  if (p.remindOn) {
    const t2 = todayYmd();
    const now = Date.now();
    const fired = getFired();
    const hits = [];
    allItems().forEach((it) => {
      if (it.done || it.parentId || !it.due) return;
      // 提醒设置三态：null = 明确选了「不提醒」；没动过 = 跟着到点提醒走
      if (it.remindAhead === null) return;
      const ahead = it.remindAhead === undefined ? 0 : it.remindAhead;
      const key = it.id + "@" + it.due + "@" + (it.time || "") + "@" + ahead;
      if (fired.indexOf(key) >= 0) return;
      const [hh, mm] = (it.time || "09:00").split(":").map(Number);
      const dueMs = new Date(it.due + "T00:00:00").getTime() + hh * 3600000 + mm * 60000;
      const at = dueMs - ahead * 60000;
      if (now >= at && now <= at + 3600000) {
        hits.push(it);
        fired.push(key);
      }
    });
    if (hits.length) {
      setFired(fired);
      hits.slice(0, 3).forEach((it) => {
        const txt = (it.time ? it.time + " " : "") + "该做了";
        if (!notifyLocal(it.title, txt)) toast("该做了：" + it.title, 3000);
      });
    }
  }
}

function getFired() {
  try { return JSON.parse(sessionStorage.getItem("daiban_fired") || "[]"); } catch (e) { return []; }
}
function setFired(a) {
  try { sessionStorage.setItem("daiban_fired", JSON.stringify(a.slice(-200))); } catch (e) { /* ignore */ }
}

/* ============================================================
   启动
   ============================================================ */

subscribe((evt) => {
  if (renderLock) return;
  render();
  // 待办有变化就把最新清单交给云端（开了云端提醒才有意义；配置类变化不用传）
  if (evt && evt.type && evt.type !== "pref" && prefs().pushOn) {
    try { push.syncSnapshot(); } catch (e) { console.warn("快照同步失败", e); }
  }
});

// 从「记一条」快捷方式打开时，直接聚焦输入框
if (location.search.indexOf("act=new") >= 0) {
  setTimeout(() => {
    const inp = document.getElementById("quickInput");
    if (inp) inp.focus();
  }, 200);
}

// 从通知点进来的（云端推送的通知带着任务号）：直接把这一条摊开
if (location.search.indexOf("act=open") >= 0) {
  const mm = location.search.match(/[?&]id=([^&]+)/);
  if (mm) {
    const oid = decodeURIComponent(mm[1]);
    setTimeout(() => {
      if (getItem(oid)) openItemSheet(oid);
    }, 400);
  }
}

render({ toTop: true });

// 打开时检查提醒（延后一点，避免和首屏抢）
setTimeout(checkOnOpen, 600);

// 云端提醒自愈：换了服务器、订阅被系统悄悄清掉的情况，用户自己是看不出来的。
// 放在启动后一会儿，别跟首屏抢网络。
setTimeout(() => {
  push.repair().then((r) => {
    if (r && r.repaired) toast("推送订阅自动修好了", 3000);
  }).catch(() => {});
}, 2500);

// 页面重新可见时也检查一次
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) checkOnOpen();
});
// 常驻开着时，每分钟扫一次
setInterval(() => {
  if (!document.hidden) checkOnOpen();
}, 60000);

/* Service Worker：装到主屏幕 + 收到通知点击回到应用 */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW 注册失败", e));
  });
}

window.addEventListener("online", () => toast("网络回来了"));
window.addEventListener("offline", () => toast("已离线，照样能记"));
