/* ============================================================
   page-me.js — 我的页（统计 + 设置）
   ============================================================ */

import { stats, prefs, getState, allTags } from "./store.js";
import { SVG } from "./ui.js";
import { esc } from "./util.js";
import { describe as pushDescribe } from "./push.js";
import { describe as backupDescribe } from "./cloud-backup.js";

function sw(on) {
  return '<span class="switch ' + (on ? "on" : "") + '"><i></i></span>';
}

function toneColor(tone) {
  if (tone === "ok") return "var(--ink-2)";
  if (tone === "err") return "var(--red)";
  return "var(--ink-3)";
}

function stat(num, label, unit, accent) {
  return (
    '<div class="stat"><div class="stat-num ' + (accent ? "accent" : "") + '">' + num +
    (unit ? "<small>" + unit + "</small>" : "") +
    '</div><div class="stat-label">' + label + "</div></div>"
  );
}

export function meHTML() {
  const st = stats();
  const p = prefs();
  const pd = pushDescribe();
  const max = Math.max(1, ...st.days.map((d) => d.cnt));

  const bars =
    '<div class="bars">' +
    st.days
      .map(
        (d) =>
          '<div class="b ' + (d.isToday ? "today" : d.cnt ? "on" : "") + '"><i style="height:' +
          Math.max(3, Math.round((d.cnt / max) * 100)) +
          '%"></i><span>' +
          esc(d.label) +
          "</span></div>"
      )
      .join("") +
    "</div>";

  const totalItems = getState().items.filter((x) => !x.parentId).length;
  const tagCnt = allTags().length;

  return (
    '<div class="stat-grid">' +
    stat(st.weekDone, "本周完成", "", true) +
    stat(st.streak, "连续坚持", " 天") +
    stat(st.pending, "还没做完") +
    stat(totalItems, "一共记过", " 条") +
    "</div>" +

    '<div class="sec-title">近 7 天 · 每天完成件数</div>' + bars +
    '<div class="row-sub" style="padding-top:8px">共 ' + tagCnt + " 个标签在用</div>" +

    '<div class="sec-title">AI 理解你的话</div>' +
    '<div class="row" data-act="toggle-ai"><div class="row-main"><div class="row-title">开启 AI 解析</div>' +
    '<div class="row-sub">' +
    (p.aiOn
      ? "开着：绕一点的说法也能听懂；连不上时自动退回本机解析"
      : "关着：只用本机解析（日期、时间、重复、标签都能认）") +
    "</div></div>" + sw(p.aiOn) + "</div>" +
    '<div class="row" data-act="test-ai"><div class="row-main"><div class="row-title">测一下通不通</div>' +
    '<div class="row-sub">已内置，不用配置。点一下拿句绕的话试试</div></div><span class="row-arrow">' + SVG.spark + "</span></div>" +
    '<div class="row" data-act="set-aimodel"><div class="row-main"><div class="row-title">换成别的模型</div>' +
    '<div class="row-sub">默认' + esc(p.aiKey ? "用自己的密钥" : "用内置的") + " · " + esc(p.aiModel || "gemini-3.8-flash") + '</div></div>' +
    '<span class="row-arrow">' + SVG.chev + "</span></div>" +

    '<div class="sec-title">提醒</div>' +
    '<div class="row" data-act="toggle-remind"><div class="row-main"><div class="row-title">到点提醒</div>' +
    '<div class="row-sub">打开着软件的时候，到时间的任务会叫你</div></div>' + sw(p.remindOn) + "</div>" +
    '<div class="row" data-act="toggle-brief"><div class="row-main"><div class="row-title">每天早上一份清单</div>' +
    '<div class="row-sub">每天第一次打开，先告诉你今天要做什么</div></div>' + sw(p.dailyBriefOn) + "</div>" +
    '<div class="row" data-act="toggle-inboxclean"><div class="row-main"><div class="row-title">提醒清理收件箱</div>' +
    '<div class="row-sub">把随手扔进收件箱的念头理一理</div></div>' + sw(p.inboxCleanOn) + "</div>" +
    '<div class="row" data-act="set-cleantime"><div class="row-main"><div class="row-title">清理时间</div></div>' +
    '<span class="row-val">' + esc(p.inboxCleanTime) + '</span><span class="row-arrow">' + SVG.chev + "</span></div>" +

    '<div class="sec-title">关掉软件也能提醒</div>' +
    '<div class="row" data-act="toggle-push"><div class="row-main"><div class="row-title">云端提醒</div>' +
    '<div class="row-sub">把"什么时候该叫你"交给云端守着，手机锁屏、软件关掉也会弹通知</div></div>' + sw(p.pushOn) + "</div>" +
    '<div class="row-sub" style="padding:7px 22px 12px;line-height:1.7;color:' + toneColor(pd.tone) + '">' +
    esc(pd.text) + "</div>" +
    (p.pushOn
      ? '<div class="row" data-act="test-push"><div class="row-main"><div class="row-title">测一下通知</div>' +
        '<div class="row-sub">让云端立刻推一条，几秒内应该弹出来</div></div><span class="row-arrow">' + SVG.spark + "</span></div>"
      : "") +

    '<div class="sec-title">数据</div>' +
    '<div class="row" data-act="cloud-save"><div class="row-main"><div class="row-title">备份到云端</div>' +
    '<div class="row-sub">' + esc(backupDescribe()) + '</div></div><span class="row-arrow">' + SVG.out + "</span></div>" +
    '<div class="row" data-act="cloud-load"><div class="row-main"><div class="row-title">从云端恢复</div>' +
    '<div class="row-sub">换手机、或者手机被清空时用它取回来（会覆盖现在的内容）</div></div><span class="row-arrow">' + SVG.in + "</span></div>" +
    '<div class="row" data-act="backup-key"><div class="row-main"><div class="row-title">备份码</div>' +
    '<div class="row-sub">' +
    esc(p.backupKey ? "这就是钥匙 —— 换手机时填它才能找回，建议截图存一份" : "第一次备份时自动生成，之后一直用它") +
    '</div></div><span class="row-val mono">' + esc(p.backupKey || "——") + "</span></div>" +
    '<div class="row" data-act="export-ics"><div class="row-main"><div class="row-title">导出到手机日历</div>' +
    '<div class="row-sub">用系统闹钟提醒 —— 这条最不会掉链子</div></div><span class="row-arrow">' + SVG.out + "</span></div>" +
    '<div class="row" data-act="export-json"><div class="row-main"><div class="row-title">存成文件</div>' +
    '<div class="row-sub">连图片一起打包成一个文件，放自己兜里</div></div><span class="row-arrow">' + SVG.out + "</span></div>" +
    '<div class="row" data-act="import-json"><div class="row-main"><div class="row-title">从文件恢复</div>' +
    '<div class="row-sub">读回之前存的文件（会覆盖现在的任务和图片）</div></div><span class="row-arrow">' + SVG.in + "</span></div>" +
    '<div class="row" data-act="clear-done"><div class="row-main"><div class="row-title">清掉已完成的</div>' +
    '<div class="row-sub">把打完勾的一次性收走</div></div><span class="row-arrow">' + SVG.chev + "</span></div>" +

    '<div class="sec-title">怎么用</div>' +
    '<div class="row" data-act="how-install"><div class="row-main"><div class="row-title">装到手机主屏幕</div>' +
    '<div class="row-sub">像 App 一样打开，也才能收到通知</div></div><span class="row-arrow">' + SVG.chev + "</span></div>" +
    '<div class="row" data-act="how-syntax"><div class="row-main"><div class="row-title">记事的写法</div>' +
    '<div class="row-sub">日期、时间、重复、标签、优先级怎么写</div></div><span class="row-arrow">' + SVG.chev + "</span></div>"
  );
}

export function meSub() {
  return "东西都存在你自己手机上";
}
