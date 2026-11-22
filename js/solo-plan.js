// 내 공부 일정 엔진 (화면과 분리된 순수 함수 — 테스트 가능)
// 원칙
//  - 날짜가 지나도 자동으로 건너뛰지 않음: 항상 "아직 안 끝난 가장 앞 회차"가 다음 공부일에 옴 (롤링 큐)
//  - PDF의 과거 날짜는 참고용일 뿐, 오늘 날짜로 회차를 계산하거나 자동 완료하지 않음
//  - 시작 회차는 사용자가 직접 고름 (그 앞 회차는 '건너뜀'으로만 표시, 시청 시간에 넣지 않음)
import { addDays, mondayOf, weekdayIdx, kstDateStr } from './dates.js';

export const DEFAULT_WEEKDAYS = [2, 3, 5, 6]; // ISO: 1=월 … 7=일 → 화·수·금·토
export const WD_KO = ['', '월', '화', '수', '목', '금', '토', '일'];
export const SPEEDS = [1, 1.25, 1.5, 2];

export function settingsOf(raw, content) {
  const weekdays = Array.isArray(raw?.weekdays) ? raw.weekdays : content?.weekdays || DEFAULT_WEEKDAYS;
  const perDay = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, ...(raw?.perDay || {}) };
  return {
    weekdays,
    perDay,
    speed: SPEEDS.includes(raw?.speed) ? raw.speed : 1,
    start: raw?.start?.seq ? raw.start : null,
    weekOverrides: raw?.weekOverrides || {},
    extra: raw?.extra || {},
    round: Math.max(1, Number(raw?.round || 1)),       // 지금 몇 회독째인지
    roundStarts: raw?.roundStarts || {},               // 2회독부터: { "2": { seq, at } }
  };
}

// ── 회독 ──
// 1회독 진도는 progress.assign/session 그대로, 2회독부터는 progress.rounds["2"].assign/session 에 따로 저장
export function roundProg(prog, r) {
  if (r <= 1) return { assign: prog?.assign || {}, session: prog?.session || {}, week: prog?.week || {} };
  const x = prog?.rounds?.[r] || {};
  return { assign: x.assign || {}, session: x.session || {}, week: prog?.week || {} };
}
export function roundSettings(settings, r) {
  return r <= 1 ? settings : { ...settings, start: settings.roundStarts?.[r] || { seq: 1, at: 0 } };
}
// 진도 저장 경로: 현재 회독에 맞춰 감싸기
export function roundPatch(r, patch) {
  return r <= 1 ? patch : { rounds: { [r]: patch } };
}

export const isoWd = (date) => weekdayIdx(date) + 1;

export function weekDaysFor(settings, date) {
  const o = settings.weekOverrides?.[mondayOf(date)];
  return Array.isArray(o) ? o : settings.weekdays;
}
export function isStudyDay(settings, date) {
  return weekDaysFor(settings, date).includes(isoWd(date));
}
// 그날 공부 분량(회차 수) = 요일별 기본 분량 + 그날 '미리 하기'로 더한 수
export function quota(settings, date) {
  const base = isStudyDay(settings, date) ? Math.max(0, Number(settings.perDay?.[isoWd(date)] ?? 1)) : 0;
  return base + Math.max(0, Number(settings.extra?.[date] || 0));
}

export function itemProg(prog, key) {
  const p = prog?.assign?.[key] || {};
  return { st: p.st || 'not_started', at: p.at || 0, note: p.note || '' };
}

export function sessionInfo(settings, prog, s) {
  const items = s.items.map((i) => ({ ...i, ...itemProg(prog, i.key) }));
  const doneN = items.filter((i) => i.st === 'completed').length;
  const sp = prog?.session?.[s.id] || {};
  const startSeq = settings.start?.seq || 1;
  const allDone = items.length > 0 && doneN === items.length;
  let done = false, skipped = false, doneAt = 0;
  if (sp.manual === 'done') { done = true; doneAt = sp.at || 0; }
  else if (sp.manual === 'undone') done = false;
  else if (allDone) { done = true; doneAt = Math.max(...items.map((i) => i.at || 0)); }
  else if (s.seq < startSeq) { done = true; skipped = true; }
  const started = doneN > 0 || items.some((i) => i.st === 'in_progress');
  const status = done ? (skipped ? 'skipped' : 'completed') : started ? 'in_progress' : 'not_started';
  const remainSec = items.filter((i) => i.st !== 'completed').reduce((t, i) => t + i.sec, 0);
  return { items, doneN, total: items.length, done, skipped, doneAt, status, manual: sp.manual || null, note: sp.note || '', remainSec };
}

export function units(content, settings, prog) {
  const out = [];
  for (const s of content.sessions) {
    const info = sessionInfo(settings, prog, s);
    out.push({ type: 'session', id: s.id, phase: 'A', s, info, done: info.done, skipped: info.skipped, doneAt: info.doneAt });
  }
  for (const w of content.weeks) {
    for (const t of w.tasks) {
      const at = prog?.week?.[w.id]?.tasks?.[t.k] || 0;
      out.push({ type: 'task', id: `${w.id}#${t.k}`, phase: w.phase, w, t, done: !!at, skipped: false, doneAt: at });
    }
  }
  return out;
}

export function phaseStatus(us) {
  const by = (p) => us.filter((u) => u.phase === p);
  const st = {};
  for (const p of ['A', 'B', 'C']) {
    const list = by(p);
    st[p] = { total: list.length, done: list.filter((u) => u.done).length };
    st[p].complete = st[p].total > 0 && st[p].done === st[p].total;
  }
  st.B.unlocked = st.A.complete;
  st.C.unlocked = st.A.complete && st.B.complete;
  st.current = !st.A.complete ? 'A' : !st.B.complete ? 'B' : !st.C.complete ? 'C' : 'done';
  return st;
}

// 오늘 할 일 + 앞으로의 배정 예상(공부일마다 분량만큼 순서대로)
export function plan(content, settings, prog, today, horizonDays = 200) {
  const us = units(content, settings, prog);
  const dateOf = (u) => (u.doneAt ? kstDateStr(u.doneAt) : null);
  const doneToday = us.filter((u) => u.done && !u.skipped && dateOf(u) === today);
  const queue = us.filter((u) => !u.done);
  const q = quota(settings, today);
  const rest = Math.max(0, q - doneToday.length);
  const todayNext = queue.slice(0, rest);
  const proj = { [today]: todayNext.map((u) => u.id) };
  let qi = rest;
  let nextStudyDate = null;
  for (let i = 1, d = addDays(today, 1); i <= horizonDays; i++, d = addDays(d, 1)) {
    const n = quota(settings, d);
    if (n <= 0) continue;
    if (!nextStudyDate) nextStudyDate = d;
    if (qi < queue.length) { proj[d] = queue.slice(qi, qi + n).map((u) => u.id); qi += n; }
    if (qi >= queue.length && nextStudyDate) break;
  }
  // 완료한 날짜별 묶음 (달력·주간 표시용)
  const doneByDate = {};
  for (const u of us) {
    const d = u.done && !u.skipped ? dateOf(u) : null;
    if (d) (doneByDate[d] ||= []).push(u.id);
  }
  // 일정에 아직 없는 회차의 예정일
  const plannedDate = {};
  for (const [d, ids] of Object.entries(proj)) for (const id of ids) plannedDate[id] = d;
  return {
    units: us, byId: Object.fromEntries(us.map((u) => [u.id, u])),
    queue, doneToday, todayNext, quota: q, rest, proj, plannedDate, doneByDate,
    nextStudyDate, nextAfterToday: queue[rest] || null, phases: phaseStatus(us),
  };
}

export function stats(content, settings, prog, p) {
  let videos = 0, watched = 0;
  const watchedVids = new Set();
  for (const u of p.units) {
    if (u.type !== 'session') continue;
    for (const i of u.info.items) if (i.st === 'completed') { videos++; watched += i.sec; watchedVids.add(i.vid); }
  }
  const sess = p.units.filter((u) => u.type === 'session');
  return {
    sessionsDone: sess.filter((u) => u.done && !u.skipped).length,
    sessionsSkipped: sess.filter((u) => u.skipped).length,
    sessionsTotal: sess.length,
    videosDone: videos,
    videosTotal: sess.reduce((t, u) => t + u.info.total, 0),
    watchedSec: watched,
    watchedVids,
  };
}

// 이번 주(월~일) 완료율: 이번 주에 끝낸 것 / (끝낸 것 + 이번 주 남은 예정)
export function weekRate(p, today) {
  const mon = mondayOf(today);
  let done = 0, planned = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(mon, i);
    done += (p.doneByDate[d] || []).length;
    if (d >= today) planned += (p.proj[d] || []).length;
  }
  return { done, planned, rate: done + planned ? done / (done + planned) : 0 };
}

// ── 실제로 한 일 (모든 회독 + 교재 + B/C 과제) ──
export function activityEvents(content, settings, prog, blog) {
  const rounds = Math.max(1, Number(settings.round || 1));
  const items = new Map(content.sessions.flatMap((s) => s.items.map((i) => [i.key, { i, s }])));
  const ev = [];
  for (let r = 1; r <= rounds; r++) {
    const rp = roundProg(prog, r);
    for (const [key, a] of Object.entries(rp.assign)) {
      const it = items.get(key);
      if (a?.st === 'completed' && a.at && it) ev.push({ d: kstDateStr(a.at), k: 'video', sec: it.i.sec, r, id: key, sid: it.s.id });
    }
    for (const u of units(content, roundSettings(settings, r), rp)) {
      if (u.type === 'session' && u.done && !u.skipped && u.doneAt) ev.push({ d: kstDateStr(u.doneAt), k: 'session', r, id: u.id });
      if (r === 1 && u.type === 'task' && u.done && u.doneAt) ev.push({ d: kstDateStr(u.doneAt), k: 'task', id: u.id });
    }
  }
  for (const [id, b] of Object.entries(blog || {})) if (b?.read) ev.push({ d: kstDateStr(b.read), k: 'blog', id });
  return ev;
}

// ── 주차별 기록 ── (미리 정한 일정 없이, 실제로 한 만큼만 집계)
// 1주차 = 시작 회차를 고른 날이 속한 주(월~일)
export function weeklyLog(content, settings, prog, blog, today, ev = activityEvents(content, settings, prog, blog)) {
  const startAt = settings.start?.at;
  let firstMon = mondayOf(startAt ? kstDateStr(startAt) : today);
  for (const e of ev) if (mondayOf(e.d) < firstMon) firstMon = mondayOf(e.d);
  const lastMon = mondayOf(today);
  const weeks = [];
  for (let mon = firstMon, idx = 1; mon <= lastMon; mon = addDays(mon, 7), idx++) {
    weeks.push({ mon, sun: addDays(mon, 6), idx, videos: 0, sec: 0, sessions: 0, tasks: 0, blogs: 0, days: [0, 0, 0, 0, 0, 0, 0], rounds: new Set() });
  }
  const byMon = new Map(weeks.map((w) => [w.mon, w]));
  for (const e of ev) {
    const w = byMon.get(mondayOf(e.d));
    if (!w) continue;
    if (e.k === 'video') { w.videos++; w.sec += e.sec; w.days[weekdayIdx(e.d)]++; w.rounds.add(e.r); }
    else if (e.k === 'session') { w.sessions++; w.rounds.add(e.r); }
    else if (e.k === 'task') w.tasks++;
    else if (e.k === 'blog') w.blogs++;
  }
  return weeks.reverse(); // 최근 주가 먼저
}

// 회독별 요약
export function roundSummary(content, settings, prog) {
  const out = [];
  for (let r = 1; r <= Math.max(1, Number(settings.round || 1)); r++) {
    const rp = roundProg(prog, r);
    const us = units(content, roundSettings(settings, r), rp).filter((u) => u.type === 'session');
    const videos = Object.values(rp.assign).filter((a) => a?.st === 'completed').length;
    const done = us.filter((u) => u.done && !u.skipped).length;
    const skipped = us.filter((u) => u.skipped).length;
    const startAt = r === 1 ? settings.start?.at : settings.roundStarts?.[r]?.at;
    const finished = us.every((u) => u.done);
    const endAt = finished ? Math.max(0, ...us.map((u) => u.doneAt || 0)) : 0;
    out.push({ r, videos, done, skipped, total: us.length, startAt, endAt, finished });
  }
  return out;
}
