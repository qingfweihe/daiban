/* ============================================================
   util.js — 通用工具 + 中文自然语言解析 + 日历导出
   设计原则：这一层完全不依赖网络，断网也能把"明天下午三点交作业"
   拆成 日期 / 时间 / 标题。
   ============================================================ */

export const WD_CN = ["日", "一", "二", "三", "四", "五", "六"];
const DIGIT = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

export function uid(p = "i") {
  return p + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function pad2(n) {
  return String(n).padStart(2, "0");
}

/* ---------- 日期 ---------- */

export function ymd(d) {
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

export function parseYmd(s) {
  const p = String(s).split("-").map(Number);
  return new Date(p[0], (p[1] || 1) - 1, p[2] || 1);
}

export function todayYmd() {
  return ymd(new Date());
}

export function addDays(s, n) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

/** 相差天数：a - b */
export function diffDays(a, b) {
  return Math.round((parseYmd(a) - parseYmd(b)) / 86400000);
}

/** 把 'YYYY-MM-DD' 说成人话 */
export function fmtDate(due) {
  if (!due) return "";
  const d = diffDays(due, todayYmd());
  if (d === 0) return "今天";
  if (d === 1) return "明天";
  if (d === 2) return "后天";
  if (d === -1) return "昨天";
  if (d === -2) return "前天";
  const dt = parseYmd(due);
  if (d > 2 && d < 7) return "周" + WD_CN[dt.getDay()];
  const y0 = new Date().getFullYear();
  return (dt.getFullYear() === y0 ? "" : dt.getFullYear() + "年") + (dt.getMonth() + 1) + "月" + dt.getDate() + "日";
}

/** 日期 + 时间的完整说法 */
export function fmtWhen(item) {
  const d = fmtDate(item.due);
  if (!d) return "";
  return item.time ? d + " " + item.time : d;
}

export function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- 中文数字 ---------- */

export function cn2num(s) {
  s = String(s).trim();
  if (/^\d+$/.test(s)) return Number(s);
  if (s === "十") return 10;
  if (DIGIT[s] != null) return DIGIT[s];
  const m = s.match(/^([一二三四五六七八九])?十([一二三四五六七八九])?$/);
  if (m) return (m[1] ? DIGIT[m[1]] : 1) * 10 + (m[2] ? DIGIT[m[2]] : 0);
  return NaN;
}

const CN_TIME = "[一二三四五六七八九十]{1,3}";

/* ---------- 自然语言解析 ---------- */

/**
 * 把一句话拆成结构化任务。
 * @returns {{title:string,due:string|null,time:string|null,repeat:object|null,
 *            priority:number,tags:string[],listType:string|null,matched:string[]}}
 */
export function parseNatural(input) {
  const base = todayYmd();
  let text = " " + String(input || "").trim() + " ";
  const out = { title: "", due: null, time: null, repeat: null, priority: 0, tags: [], listType: null, matched: [] };

  const eat = (re, fn) => {
    text = text.replace(re, (...args) => {
      if (fn) fn(args);
      return " ";
    });
  };

  /* --- 标签 #xxx --- */
  eat(/#([^\s#，,。；;]{1,14})/g, (a) => out.tags.push(a[1]));

  /* --- 优先级 ! !! --- */
  if (/!{2,}/.test(text)) { out.priority = 2; eat(/!{2,}/g); }
  else if (/!/.test(text)) { out.priority = 1; eat(/!/g); }

  /* --- 重复 --- */
  if (/每(天|日)|天天/.test(text)) { out.repeat = { type: "daily", n: 1 }; eat(/每(天|日)|天天/g); }
  else if (/工作日/.test(text)) { out.repeat = { type: "weekdays" }; eat(/工作日/g); }
  else {
    const mw = text.match(/每(周|星期|礼拜)([一二三四五六日天])/);
    if (mw) {
      const w = mw[2] === "天" ? 0 : "一二三四五六日".indexOf(mw[2]) + 1;
      out.repeat = { type: "weekly", wd: w };
      eat(/每(周|星期|礼拜)([一二三四五六日天])/);
    } else if (/每(周|星期|礼拜)/.test(text)) {
      out.repeat = { type: "weekly", wd: null };
      eat(/每(周|星期|礼拜)/g);
    } else {
      const mm = text.match(new RegExp("每(个)?月\\s*(\\d{1,2}|" + CN_TIME + ")?\\s*[号日]?"));
      if (mm && mm[0].replace(/每(个)?月/, "").trim() !== "") {
        out.repeat = { type: "monthly", day: cn2num(mm[2]) || null };
        eat(new RegExp("每(个)?月\\s*(\\d{1,2}|" + CN_TIME + ")?\\s*[号日]?"));
      } else if (/每(个)?月/.test(text)) {
        out.repeat = { type: "monthly", day: null };
        eat(/每(个)?月[号日]?/g);
      }
    }
  }

  /* --- 日期 --- */
  let due = null;
  const setDue = (v) => { if (due === null) due = v; };

  if (/大后天/.test(text)) { setDue(addDays(base, 3)); eat(/大后天/g); }
  else if (/后天/.test(text)) { setDue(addDays(base, 2)); eat(/后天/g); }
  else if (/明天|明日|明早|明晚|明儿/.test(text)) { setDue(addDays(base, 1)); eat(/明天|明日|明早|明晚|明儿/g); }
  else if (/今天|今日|今晚|今早|今儿/.test(text)) { setDue(base); eat(/今天|今日|今晚|今早|今儿/g); }

  if (due === null) {
    const md = text.match(new RegExp("(\\d{1,2}|" + CN_TIME + ")\\s*天(后|之后|以后)"));
    if (md) { setDue(addDays(base, cn2num(md[1]))); eat(new RegExp("(\\d{1,2}|" + CN_TIME + ")\\s*天(后|之后|以后)")); }
  }

  if (due === null) {
    const mn = text.match(/下(下)?(周|星期|礼拜)([一二三四五六日天])/);
    if (mn) {
      const w = mn[3] === "天" ? 0 : "一二三四五六日".indexOf(mn[3]) + 1;
      const t = parseYmd(base);
      const cur = t.getDay();
      const toMon = cur === 0 ? 1 : 8 - cur; // 下周一
      const off = mn[1] ? toMon + 7 : toMon;
      setDue(addDays(base, off + (w === 0 ? 6 : w - 1)));
      eat(/下(下)?(周|星期|礼拜)([一二三四五六日天])/);
    }
  }

  if (due === null) {
    const mw = text.match(/(本)?(周|星期|礼拜)([一二三四五六日天])/);
    if (mw) {
      const w = mw[3] === "天" ? 0 : "一二三四五六日".indexOf(mw[3]) + 1;
      let off = w - parseYmd(base).getDay();
      if (off <= 0) off += 7;
      setDue(addDays(base, off));
      eat(/(本)?(周|星期|礼拜)([一二三四五六日天])/);
    }
  }

  if (due === null) {
    const mD = text.match(new RegExp("(\\d{1,2}|" + CN_TIME + ")\\s*月\\s*(\\d{1,2}|" + CN_TIME + ")\\s*[号日]"));
    if (mD) {
      const mo = cn2num(mD[1]), da = cn2num(mD[2]);
      const y = new Date().getFullYear();
      if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
        let cand = y + "-" + pad2(mo) + "-" + pad2(da);
        if (diffDays(cand, base) < -180) cand = (y + 1) + "-" + pad2(mo) + "-" + pad2(da);
        setDue(cand);
        eat(new RegExp("(\\d{1,2}|" + CN_TIME + ")\\s*月\\s*(\\d{1,2}|" + CN_TIME + ")\\s*[号日]"));
      }
    }
  }

  if (due === null) {
    const ms = text.match(/(^|\s)(\d{1,2})[\/\-\.](\d{1,2})(\s|$)/);
    if (ms) {
      const mo = Number(ms[2]), da = Number(ms[3]);
      if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
        const y = new Date().getFullYear();
        let cand = y + "-" + pad2(mo) + "-" + pad2(da);
        if (diffDays(cand, base) < -180) cand = (y + 1) + "-" + pad2(mo) + "-" + pad2(da);
        setDue(cand);
        eat(/(^|\s)(\d{1,2})[\/\-\.](\d{1,2})(\s|$)/);
      }
    }
  }

  /* --- 时间 --- */
  let time = null;
  const mHM = text.match(/(\d{1,2})[:：](\d{2})/);
  if (mHM && Number(mHM[1]) <= 24 && Number(mHM[2]) <= 59) {
    time = pad2(Number(mHM[1]) % 24) + ":" + mHM[2];
    eat(/(\d{1,2})[:：](\d{2})/);
  } else {
    const re = new RegExp("(凌晨|早上|早晨|清晨|上午|中午|下午|傍晚|晚上|夜里|晚)?\\s*(\\d{1,2}|" + CN_TIME + ")\\s*[点时]\\s*(半|整|\\d{1,2}\\s*分|" + CN_TIME + "\\s*分)?");
    const mT = text.match(re);
    if (mT) {
      const period = mT[1] || "";
      let h = cn2num(mT[2]);
      let mi = 0;
      const tail = (mT[3] || "").replace(/\s/g, "");
      if (tail === "半") mi = 30;
      else if (tail === "整" || tail === "") mi = 0;
      else {
        const mm = tail.match(/(\d{1,2}|[一二三四五六七八九十]{1,3})/);
        mi = mm ? cn2num(mm[1]) : 0;
      }
      if (!isNaN(h) && h >= 0 && h <= 24 && !isNaN(mi) && mi >= 0 && mi < 60) {
        if (/下午|傍晚|晚上|夜里/.test(period)) { if (h < 12) h += 12; else if (h === 12) h = 12; }
        else if (/中午/.test(period)) { if (h <= 2) h += 12; }
        else if (/凌晨/.test(period)) { if (h === 12) h = 0; }
        else if (!period && h <= 4 && h !== 0) { h += 12; } // "3点" 默认下午
        if (h === 24) h = 0;
        time = pad2(h) + ":" + pad2(mi);
        eat(re);
      }
    }
  }

  // 只有"上午/下午"这类时段词、没有具体点数
  if (!time) {
    const mp = text.match(/(上午|早上|中午|下午|晚上|傍晚)/);
    if (mp) {
      const map = { 上午: "09:00", 早上: "08:00", 中午: "12:00", 下午: "14:00", 傍晚: "18:00", 晚上: "20:00" };
      time = map[mp[1]];
      eat(/(上午|早上|中午|下午|晚上|傍晚)/);
    }
  }

  out.due = due;
  out.time = time;
  if (out.repeat && out.repeat.type === "weekly" && out.repeat.wd == null && due) {
    out.repeat.wd = parseYmd(due).getDay();
  }

  /* --- 标题 = 挖掉时间片段后剩下的 --- */
  out.title = text
    .replace(/\s+/g, " ")
    .replace(/^[\s,，。、;；:：\-—+~、]+/, "")
    .replace(/[\s,，。、;；:：\-—]+$/, "")
    .trim();

  /* --- 猜清单归属 --- */
  const probe = out.title + " " + out.tags.join(" ");
  if (/复习|背书|刷题|做题|预习|作业|考试|网课|单词|题库|讲义|国网|电工|高数|英语|学习/.test(probe)) out.listType = "study";
  else if (/买|购|取|寄|快递|缴|付|充值|还|借|洗|打扫|超市|菜|饭|药|理发|约|挂号|修/.test(probe)) out.listType = "life";
  else if (/计划|目标|项目|坚持|打卡|练|完成|推进|准备|整理/.test(probe)) out.listType = "long";

  return out;
}

/* ---------- 重复任务 ---------- */

export function repeatLabel(r) {
  if (!r) return "";
  if (r.type === "daily") return r.n > 1 ? "每 " + r.n + " 天" : "每天";
  if (r.type === "weekdays") return "工作日";
  if (r.type === "weekly") return r.wd == null ? "每周" : "每周" + WD_CN[r.wd];
  if (r.type === "monthly") return r.day ? "每月 " + r.day + " 号" : "每月";
  return "";
}

/** 由当前日期算出下一次应当出现的日期 */
export function nextDue(due, repeat) {
  if (!repeat || !due) return due;
  if (repeat.type === "daily") return addDays(due, repeat.n || 1);
  if (repeat.type === "weekly") return addDays(due, 7);
  if (repeat.type === "weekdays") {
    let d = addDays(due, 1);
    while (parseYmd(d).getDay() === 0 || parseYmd(d).getDay() === 6) d = addDays(d, 1);
    return d;
  }
  if (repeat.type === "monthly") {
    const dt = parseYmd(due);
    const day = repeat.day || dt.getDate();
    const y = dt.getFullYear();
    const m = dt.getMonth() + 1;
    const ny = m === 12 ? y + 1 : y;
    const nm = m === 12 ? 1 : m + 1;
    const last = new Date(ny, nm, 0).getDate();
    return ny + "-" + pad2(nm) + "-" + pad2(Math.min(day, last));
  }
  return null;
}

/* ---------- 导出日历（.ics） ---------- */

function icsEscape(s) {
  return String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function toIcsLocal(due, time, addMin) {
  const [y, m, d] = due.split("-").map(Number);
  let hh = 0, mm = 0;
  if (time) { hh = Number(time.slice(0, 2)); mm = Number(time.slice(3, 5)); }
  const dt = new Date(y, m - 1, d, hh, mm + (addMin || 0));
  return (
    dt.getFullYear() + pad2(dt.getMonth() + 1) + pad2(dt.getDate()) + "T" + pad2(dt.getHours()) + pad2(dt.getMinutes()) + "00"
  );
}

/**
 * 生成日历文件内容。有时间的任务 = 定时事件 + 闹钟；没时间的 = 全天事件。
 */
export function buildICS(items, opt = {}) {
  const alarmMin = opt.alarmMin == null ? 15 : opt.alarmMin;
  const stamp = (() => {
    const d = new Date();
    return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) + "T" + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + "Z";
  })();

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//qinfweihe//daiban//CN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:待办",
  ];

  items.forEach((it) => {
    if (!it.due) return;
    const rrule = it.repeat ? icsRRule(it) : null;
    lines.push("BEGIN:VEVENT");
    lines.push("UID:" + it.id + "@daiban");
    lines.push("DTSTAMP:" + stamp);
    if (it.time) {
      lines.push("DTSTART:" + toIcsLocal(it.due, it.time, 0));
      lines.push("DTEND:" + toIcsLocal(it.due, it.time, 30));
    } else {
      const dt = it.due.replace(/-/g, "");
      lines.push("DTSTART;VALUE=DATE:" + dt);
      lines.push("DTEND;VALUE=DATE:" + addDays(it.due, 1).replace(/-/g, ""));
    }
    if (rrule) lines.push("RRULE:" + rrule);
    lines.push("SUMMARY:" + icsEscape((it.priority === 2 ? "❗ " : it.priority === 1 ? "★ " : "") + it.title));
    const desc = [];
    if (it.note) desc.push(it.note);
    if (it.tags && it.tags.length) desc.push("标签：" + it.tags.map((t) => "#" + t).join(" "));
    if (desc.length) lines.push("DESCRIPTION:" + icsEscape(desc.join("\n")));
    if (it.time) {
      lines.push("BEGIN:VALARM");
      lines.push("TRIGGER:-PT" + alarmMin + "M");
      lines.push("ACTION:DISPLAY");
      lines.push("DESCRIPTION:" + icsEscape(it.title));
      lines.push("END:VALARM");
    } else {
      lines.push("BEGIN:VALARM");
      lines.push("TRIGGER:-PT9H"); // 全天事件：当天早 9 点（相对 0 点）
      lines.push("ACTION:DISPLAY");
      lines.push("DESCRIPTION:" + icsEscape(it.title));
      lines.push("END:VALARM");
    }
    lines.push("END:VEVENT");
  });

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

function icsRRule(it) {
  const r = it.repeat;
  if (!r) return null;
  if (r.type === "daily") return r.n > 1 ? "FREQ=DAILY;INTERVAL=" + r.n : "FREQ=DAILY";
  if (r.type === "weekdays") return "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
  if (r.type === "weekly") {
    const map = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
    const wd = r.wd == null && it.due ? parseYmd(it.due).getDay() : r.wd || 1;
    return "FREQ=WEEKLY;BYDAY=" + map[wd];
  }
  if (r.type === "monthly") {
    const day = r.day || (it.due ? Number(it.due.slice(8, 10)) : 1);
    return "FREQ=MONTHLY;BYMONTHDAY=" + day;
  }
  return null;
}

/* ---------- 其他 ---------- */

export function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime || "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 400);
}

export function copyText(s) {
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(s);
  const ta = document.createElement("textarea");
  ta.value = s;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); } catch (e) { /* ignore */ }
  ta.remove();
  return Promise.resolve();
}
