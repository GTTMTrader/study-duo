import { firebaseConfig } from './config.js';
import { TYPES, chaptersToText, textToChapters } from './defaults.js';
import {
  nowMs, todayKST, setTodayOverride, kstHHMM, daysBetween, addDays, mondayOf, weekdayIdx,
  dateLabel, shortDate, getPhase, splitHM, hmText, clockText,
} from './dates.js';
import { deviceLabel } from './device.js';

const VERSION = '1.0.3';
const $app = document.getElementById('app');
const params = new URLSearchParams(location.search);
const isDemo = !firebaseConfig.apiKey;

// ───────────────── 저장소 선택 ─────────────────
let store;
if (isDemo) {
  if (params.get('today')) setTodayOverride(params.get('today'));
  const { createDemoStore } = await import('./store-demo.js');
  store = createDemoStore({ sample: params.get('sample') === '1' });
} else {
  const { createFirebaseStore } = await import('./store-firebase.js');
  store = createFirebaseStore();
}

// ───────────────── 화면 상태 ─────────────────
const pref = (() => {
  try { return JSON.parse(localStorage.getItem('studyduo-ui') || '{}'); } catch (e) { return {}; }
})();
const ui = {
  tab: ['home', 'timer', 'progress', 'stats'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home',
  statsRange: pref.statsRange || 'week',
  progCh: null,
  progBook: 'concept',
  timerCh: pref.timerCh || null,
  timerChWeek: pref.timerChWeek || null,
  timerType: pref.timerType || '개념서',
  showAllRecent: false,
  wake: !!pref.wake,
  sheet: false,
};
function savePref() {
  try {
    localStorage.setItem('studyduo-ui', JSON.stringify({
      statsRange: ui.statsRange, timerCh: ui.timerCh, timerChWeek: ui.timerChWeek, timerType: ui.timerType, wake: ui.wake,
    }));
  } catch (e) {}
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ───────────────── 계산 (전부 세션 원본에서) ─────────────────
const S = () => store.state;
const meId = () => S().user?.uid;
const friendId = () => Object.keys(S().members || {}).find((k) => k !== meId()) || null;
const friendName = () => {
  const f = friendId();
  return (f && S().members[f]?.name) || '친구';
};
const chapters = () => S().room?.chapters || [];
const chapterByNo = (no) => chapters().find((c) => c.no === Number(no));

function activeElapsed(a, now = nowMs()) {
  if (!a) return 0;
  return a.accumSec + (a.paused || !a.segStart ? 0 : Math.max(0, (now - a.segStart) / 1000));
}
function activeDate(a) {
  return new Date(a.sessionStart + 9 * 3600e3).toISOString().slice(0, 10);
}
// uid의 [from, to] 날짜 범위 공부시간(초). 진행 중 타이머 포함.
function secIn(uid, from, to, filter = () => true) {
  if (!uid) return 0;
  let t = 0;
  for (const s of S().sessions) {
    if (s.uid !== uid || !filter(s)) continue;
    if ((from && s.dateKST < from) || (to && s.dateKST > to)) continue;
    t += s.durationSec;
  }
  const a = S().active[uid];
  if (a && filter(a)) {
    const d = activeDate(a);
    if (!((from && d < from) || (to && d > to))) t += activeElapsed(a);
  }
  return t;
}

function phaseNow() {
  const r = S().room;
  return getPhase(todayKST(), r.curriculumStart, r.examDate, chapters().length);
}
function currentChapterNo() {
  const p = phaseNow();
  if (p.kind === 'week' || p.kind === 'before') return chapters()[(p.week || 1) - 1]?.no ?? chapters()[0]?.no;
  return null;
}

function conceptDone(uid, chNo) {
  const ch = chapterByNo(chNo);
  const list = S().progress[uid]?.concept?.[chNo] || [];
  return ch ? list.filter((i) => i < ch.topics.length).length : 0;
}
function workbookOf(uid, chNo) {
  return S().progress[uid]?.workbook?.[chNo] || {};
}

// ───────────────── 공통 조각 ─────────────────
const ICONS = {
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  home: '<svg viewBox="0 0 24 24"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/></svg>',
  timer: '<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="8"/><path d="M12 13V8M9 2h6M18 5l2 2"/></svg>',
  progress: '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 13l2 2 4-4"/></svg>',
  stats: '<svg viewBox="0 0 24 24"><path d="M4 21V13M9 21V7M14 21V15M19 21V3"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
};

function scoreHTML(sec, cls = 'score') {
  const { h, m } = splitHM(sec);
  if (h === 0) return `<div class="${cls}">${m}<span class="unit">분</span></div>`;
  return `<div class="${cls}">${h}<span class="unit">시간</span>${String(m).padStart(2, '0')}<span class="unit">분</span></div>`;
}
function smallHM(sec) {
  const { h, m } = splitHM(sec);
  if (h === 0) return `${m}<span>분</span>`;
  return `${h}<span>시간</span>${String(m).padStart(2, '0')}<span>분</span>`;
}

function head(brand, title, extra = '') {
  return `<div class="apphead"><div><div class="smallbrand">${brand}</div><div class="app-title">${title}</div></div>
  <div class="head-right">${extra}<button class="icon-btn" data-action="open-settings" aria-label="설정">${ICONS.gear}</button></div></div>`;
}

function ddayBadge() {
  const r = S().room;
  const p = phaseNow();
  const md = shortDate(r.examDate);
  if (p.kind === 'exam') return `<div class="dday exam"><small>${md} 시험</small><b>D-DAY</b></div>`;
  if (p.kind === 'done') return `<div class="dday"><small>${md} 시험</small><b>종료</b></div>`;
  return `<div class="dday"><small>${md} 시험</small><b>D-${p.dExam}</b></div>`;
}

// ───────────────── 홈 ─────────────────
function renderHome() {
  const me = meId();
  const fr = friendId();
  const today = todayKST();
  const mon = mondayOf(today);
  const sun = addDays(mon, 6);
  const p = phaseNow();

  // 상단 주차 표시
  let pillText, metaText = '';
  if (p.kind === 'week' || p.kind === 'before') {
    const ch = chapters()[(p.week || 1) - 1];
    pillText = p.kind === 'before' ? `시작 D-${p.daysToStart}` : `WEEK ${String(p.week).padStart(2, '0')}`;
    if (ch) metaText = `${esc(ch.title)}${ch.pages ? ` <span style="color:#c2c8d4;padding:0 5px">·</span> ${esc(ch.pages)}` : ''}`;
  } else if (p.kind === 'review') {
    pillText = '최종 복습 기간';
    metaText = `시험까지 ${p.dExam}일`;
  } else if (p.kind === 'exam') {
    pillText = '오늘 시험';
    metaText = '지금까지 한 거 믿고 가자';
  } else {
    pillText = '시험 종료';
    metaText = '수고했어요';
  }

  // 주간 대결
  const myW = secIn(me, mon, sun);
  const frW = secIn(fr, mon, sun);
  const total = myW + frW;
  const myPct = total ? Math.max(4, Math.min(96, (myW / total) * 100)) : 50;
  let msg, msgCls = '';
  const diff = Math.abs(myW - frW);
  if (!total) { msg = '이번 주 첫 기록을 남겨보세요'; msgCls = 'even'; }
  else if (diff < 60) { msg = '지금은 동점이에요'; msgCls = 'even'; }
  else if (myW > frW) msg = `${hmText(diff)} 앞서 있어요`;
  else { msg = `${hmText(diff)} 뒤처져 있어요`; msgCls = 'behind'; }
  const leader = total && diff >= 60 ? (myW > frW ? 'me' : 'fr') : null;
  const liveTag = (uid, cls) => {
    const a = S().active[uid];
    if (!a) return '';
    return `<span class="live ${cls}">${a.paused ? '일시정지' : '공부 중'}</span>`;
  };

  // 오늘
  const myT = secIn(me, today, today);
  const frT = secIn(fr, today, today);

  // 함께 달성할 목표
  let goal;
  if (p.kind === 'week' || p.kind === 'before') {
    const ch = chapters()[(p.week || 1) - 1];
    if (!ch) goal = `<div class="card empty-note">챕터가 없어요. 설정에서 입력해 주세요.</div>`;
    else if (!ch.topics.length) {
      goal = `<div class="card"><div class="row"><span class="strong" style="font-size:14px">개념서 단원 완료</span></div>
        <div class="empty-note" style="margin-top:8px">이 챕터의 단원 목록이 아직 없어요. <button class="linkish" data-action="open-settings">설정</button>에서 개념서 목차를 입력하면 진도 체크가 생겨요.</div></div>`;
    } else {
      const n = ch.topics.length;
      const a = conceptDone(me, ch.no);
      const b = conceptDone(fr, ch.no);
      goal = goalCard('개념서 단원 완료', `총 ${n}개 단원`, a, b, n);
    }
  } else {
    let n = 0, a = 0, b = 0;
    for (const ch of chapters()) {
      n += ch.topics.length;
      a += conceptDone(me, ch.no);
      b += conceptDone(fr, ch.no);
    }
    goal = n ? goalCard('전체 개념서 단원', `총 ${n}개 단원`, a, b, n) : `<div class="card empty-note">설정에서 단원 목록을 입력해 주세요.</div>`;
  }
  const goalLabel = p.kind === 'week' || p.kind === 'before' ? `Chapter ${chapters()[(p.week || 1) - 1]?.no ?? ''}` : '전체';

  const myActive = S().active[me];
  const cta = myActive
    ? `<button class="running" data-action="go" data-tab="timer"><span class="live-dot"></span> <span data-live="cta">${myActive.paused ? '일시정지 중' : '공부 중'} · ${clockText(activeElapsed(myActive))}</span><span class="arrow">→</span></button>`
    : `<button data-action="go" data-tab="timer">▶&nbsp; 공부 시작하기 <span class="arrow">→</span></button>`;

  return `
  ${head('STUDY DUO', '우리의 공부<span class="dot-end">.</span>', ddayBadge())}
  <div class="row meta-row"><span class="pill blue">${pillText}</span><div class="muted mini">${metaText}</div></div>
  <div class="duel">
    <div class="row" style="margin-bottom:14px"><span class="eyebrow">THIS WEEK'S RACE</span><span class="pill">주간 대결</span></div>
    <div class="row" style="align-items:flex-end">
      <div><div class="who"><span class="dot me"></span>나${leader === 'me' ? ' <span>🏅</span>' : ''} ${liveTag(me, 'me')}</div>${scoreHTML(myW)}</div>
      <div style="text-align:right"><div class="who" style="justify-content:flex-end">${liveTag(fr, 'fr')} <span class="dot fr"></span>${esc(friendName())}${leader === 'fr' ? ' <span>🏅</span>' : ''}</div>${scoreHTML(frW)}</div>
    </div>
    <div class="race-track">${total ? `<div style="background:#4268ef;width:${myPct}%"></div><div style="background:var(--fr-bar);width:${100 - myPct}%"></div>` : '<div style="width:100%;background:#e6e9f0"></div>'}</div>
    <div class="row" style="margin-top:14px"><span class="race-msg ${msgCls}">${msg}</span><span class="mini muted">월~일 누적</span></div>
  </div>
  ${!fr ? `<div class="empty-note" style="margin-top:10px;text-align:center">${isDemo ? '' : '친구가 아직 한 번도 로그인하지 않았어요.'}</div>` : ''}
  <div class="row sec-row"><span class="section-label">오늘은 얼마나 했을까?</span><span class="muted mini">${dateLabel(today)}</span></div>
  <div class="todayrow">
    <div><div class="mini muted">나</div><div class="todaytime c-me">${smallHM(myT)}</div></div>
    <div class="vline"></div>
    <div><div class="mini muted">${esc(friendName())}</div><div class="todaytime c-fr">${smallHM(frT)}</div></div>
  </div>
  <div class="row sec-row" style="margin-bottom:10px"><span class="section-label">함께 달성할 목표</span><span class="mini muted">${goalLabel}</span></div>
  ${goal}
  <div class="cta">${cta}</div>`;
}

function goalCard(title, sub, a, b, n) {
  return `<div class="card" style="padding:17px 18px"><div class="row"><span class="strong" style="font-size:14px">${title}</span><span class="mini muted">${sub}</span></div>
    <div class="goal-line" style="margin-top:15px"><div class="lbl c-me">나</div><div class="progress-track" style="flex:1"><div class="progress-fill" style="width:${(a / n) * 100}%;background:var(--me)"></div></div><span class="mini strong">${a} / ${n}</span></div>
    <div class="goal-line" style="margin-top:11px"><div class="lbl c-fr">${esc(friendName())}</div><div class="progress-track" style="flex:1"><div class="progress-fill" style="width:${(b / n) * 100}%;background:var(--fr)"></div></div><span class="mini strong">${b} / ${n}</span></div></div>`;
}

// ───────────────── 타이머 ─────────────────
function timerChapter() {
  const a = S().active[meId()];
  if (a) return a.chapter;
  if (ui.timerCh && chapterByNo(ui.timerCh)) {
    // 주차가 바뀌면 자동으로 이번 주 챕터로
    const cur = currentChapterNo();
    if (cur && ui.timerChWeek && ui.timerChWeek !== cur) return cur;
    return ui.timerCh;
  }
  return currentChapterNo() ?? chapters()[0]?.no;
}

function renderTimer() {
  const me = meId();
  const a = S().active[me];
  const today = todayKST();
  const chNo = timerChapter();
  const ch = chapterByNo(chNo);
  const type = a ? a.type : ui.timerType;
  const mineToday = S().sessions.filter((s) => s.uid === me && s.dateKST === today).sort((x, y) => x.startAt - y.startAt);
  const nth = mineToday.length + 1;
  const status = !a ? 'idle' : a.paused ? 'paused' : 'running';

  const opts = chapters()
    .map((c, i) => `<option value="${c.no}" ${c.no === chNo ? 'selected' : ''}>W${String(i + 1).padStart(2, '0')}  ${esc(c.title)}</option>`)
    .join('');
  const idx = chapters().findIndex((c) => c.no === chNo);

  let controls;
  if (status === 'idle') controls = `<button class="btn-primary" data-action="t-start">▶&nbsp; 시작</button>`;
  else if (status === 'running') controls = `<button class="btn-primary" data-action="t-pause">Ⅱ&nbsp; 일시정지</button><button class="btn-ghost" data-action="t-stop">■&nbsp; 종료</button>`;
  else controls = `<button class="btn-primary" data-action="t-resume">▶&nbsp; 계속하기</button><button class="btn-ghost" data-action="t-stop">■&nbsp; 종료</button>`;

  const statusLine = status === 'idle'
    ? `<div class="focus-line idle">준비됐으면 시작</div>`
    : `<div class="focus-line ${status}"><span class="live-dot"></span> ${status === 'paused' ? '일시정지' : '공부 중'}</div>`;

  const meta = status === 'idle'
    ? `오늘의 ${ordinal(nth)} 집중 세션`
    : `오늘의 ${ordinal(nth)} 집중 세션${a.device && a.device !== deviceLabel() ? ` · ${esc(a.device)}에서 시작` : ''}`;

  const list = mineToday.length
    ? mineToday.map((s) => `<div class="session"><span style="color:#8991a3">${kstHHMM(s.startAt)}–${kstHHMM(s.endAt)}</span><span>${esc(s.type)}</span><b>${hmText(s.durationSec)}</b></div>`).join('')
    : `<div class="empty-note" style="padding-top:12px">아직 저장된 세션이 없어요.</div>`;

  return `
  ${head('FOCUS MODE', '집중 타이머')}
  <div class="selector ${a ? 'locked' : ''}">
    <span>W${String(idx + 1).padStart(2, '0')} &nbsp; ${esc(ch?.title || '챕터 없음')}</span><span class="chev">${a ? '🔒' : '⌄'}</span>
    ${a ? '' : `<select data-action="t-chapter" aria-label="챕터 선택">${opts}</select>`}
  </div>
  <div class="types">${TYPES.map((t) => `<button class="${t === type ? 'selected' : ''}" data-action="t-type" data-type="${t}" ${a ? 'disabled' : ''}>${t}</button>`).join('')}</div>
  <div class="focus-zone">${statusLine}<div class="clock ${status === 'idle' ? 'idle' : ''}" data-live="clock">${clockText(activeElapsed(a))}</div><div class="clockmeta">${meta}</div></div>
  <div class="controls">${controls}</div>
  <div class="sub-actions">
    <button data-action="t-wake" class="${ui.wake ? 'on' : ''}">${ui.wake ? '☀ 화면 켜둠' : '☀ 화면 켜두기'}</button>
    ${a ? `<button data-action="t-discard">기록 안 하고 취소</button>` : ''}
  </div>
  <div class="timepanel">
    <div class="row"><span style="font-size:13px;color:#778198;font-weight:750">오늘 누적 · 진행 중 포함</span><span style="font-size:22px;font-weight:900" data-live="todayTotal">${hmText(secIn(me, today, today))}</span></div>
    <div class="separator"></div>
    <div class="row"><span style="font-size:14px;color:#45506b;font-weight:750">저장된 세션</span><span class="mini" style="color:#8991a3">${mineToday.length}개</span></div>
    ${list}
  </div>
  <div class="quiet">지금은 나의 시간. 경쟁 결과는 홈에서 확인해요.</div>`;
}
const ORD = ['첫', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열'];
function ordinal(n) {
  return ORD[n - 1] ? `${ORD[n - 1]} 번째` : `${n}번째`;
}

// ───────────────── 진도 ─────────────────
function renderProgress() {
  const me = meId();
  const fr = friendId();
  const cur = currentChapterNo();
  if (ui.progCh == null || !chapterByNo(ui.progCh)) ui.progCh = cur ?? chapters()[0]?.no;
  const ch = chapterByNo(ui.progCh);
  const chips = chapters()
    .map((c) => `<button class="weekitem ${c.no === ui.progCh ? 'selected' : ''} ${c.no === cur ? 'now' : ''}" data-action="p-ch" data-ch="${c.no}">${String(c.no).padStart(2, '0')}<small>${esc(c.title)}</small></button>`)
    .join('');
  if (!ch) return `${head('KEEP GOING', '학습 진도')}<div class="card empty-note">챕터가 없어요. 설정에서 입력해 주세요.</div>`;

  let body;
  if (ui.progBook === 'concept') {
    const n = ch.topics.length;
    const mine = S().progress[me]?.concept?.[ch.no] || [];
    const theirs = S().progress[fr]?.concept?.[ch.no] || [];
    body = n
      ? `<div class="mini-progress"><div><span class="c-me">● 나</span><b>${conceptDone(me, ch.no)} / ${n}</b></div><div><span class="c-fr">● ${esc(friendName())}</span><b>${conceptDone(fr, ch.no)} / ${n}</b></div></div>
        <div class="listhead"><span>학습 항목</span><span>나</span><span>${esc(friendName().slice(0, 3))}</span></div>
        ${ch.topics.map((t, i) => `<div class="topic"><div><span class="num">${i + 1}.</span>${esc(t)}</div>
          <button class="check ${mine.includes(i) ? 'on' : ''}" data-action="p-concept" data-i="${i}" aria-label="${esc(t)} 완료">${`<span>${mine.includes(i) ? ICONS.check : ''}</span>`}</button>
          <span class="check fr ${theirs.includes(i) ? 'on' : ''}">${theirs.includes(i) ? ICONS.check : ''}</span></div>`).join('')}`
      : `<div class="card empty-note" style="margin-top:14px">이 챕터의 단원 목록이 아직 없어요.<br>개념서 목차 사진 보고 <button class="linkish" data-action="open-settings">설정</button>에서 단원을 입력해 주세요.</div>`;
  } else {
    const mw = workbookOf(me, ch.no);
    const fw = workbookOf(fr, ch.no);
    const cnt = (w) => (w.solved ? 1 : 0) + (w.wrong ? 1 : 0);
    const row = (key, label) => `<div class="topic"><div>${label}</div>
      <button class="check ${mw[key] ? 'on' : ''}" data-action="p-wb" data-key="${key}" aria-label="${label}"><span>${mw[key] ? ICONS.check : ''}</span></button>
      <span class="check fr ${fw[key] ? 'on' : ''}">${fw[key] ? ICONS.check : ''}</span></div>`;
    body = `<div class="mini-progress"><div><span class="c-me">● 나</span><b>${cnt(mw)} / 2</b></div><div><span class="c-fr">● ${esc(friendName())}</span><b>${cnt(fw)} / 2</b></div></div>
      <div class="listhead"><span>문제집</span><span>나</span><span>${esc(friendName().slice(0, 3))}</span></div>
      ${row('solved', '풀이 완료')}${row('wrong', '오답 정리')}
      <div class="practice-hint"><b>문제집은 간단하게.</b><span>풀이 완료 · 오답 정리 완료만 체크</span></div>`;
  }

  return `
  ${head('KEEP GOING', '학습 진도')}
  <div class="week-scroll" id="chips">${chips}</div>
  <div class="row chap-head"><div><div class="chap-no">CHAPTER ${String(ch.no).padStart(2, '0')}</div><div class="chap-title">${esc(ch.title)}</div></div><div class="muted" style="font-size:13px">${esc(ch.pages)}</div></div>
  <div class="booktabs"><button class="${ui.progBook === 'concept' ? 'active' : ''}" data-action="p-book" data-book="concept">개념서</button><button class="${ui.progBook === 'workbook' ? 'active' : ''}" data-action="p-book" data-book="workbook">문제집</button></div>
  ${body}`;
}

// ───────────────── 기록 ─────────────────
function renderStats() {
  const me = meId();
  const fr = friendId();
  const today = todayKST();
  const r = S().room;
  let from, to, title, rangeNote, chart;

  if (ui.statsRange === 'today') {
    from = to = today;
    title = '오늘 공부시간';
    rangeNote = dateLabel(today);
    const cols = TYPES.map((t) => ({ label: t, a: secIn(me, from, to, (s) => s.type === t), b: secIn(fr, from, to, (s) => s.type === t) }));
    chart = barChart(cols);
  } else if (ui.statsRange === 'week') {
    from = mondayOf(today);
    to = addDays(from, 6);
    title = '주간 누적 공부시간';
    rangeNote = '월–일';
    const cols = ['월', '화', '수', '목', '금', '토', '일'].map((l, i) => {
      const d = addDays(from, i);
      return { label: l, a: secIn(me, d, d), b: secIn(fr, d, d), today: d === today };
    });
    chart = barChart(cols);
  } else {
    from = null; to = null;
    title = '전체 누적 공부시간';
    rangeNote = `${shortDate(r.curriculumStart)}~`;
    const n = chapters().length;
    const bucket = (date) => {
      const w = Math.floor(daysBetween(r.curriculumStart, date) / 7) + 1;
      if (w < 1) return '준비';
      if (w > n) return '복습';
      return `W${w}`;
    };
    const curB = bucket(today);
    const labels = ['준비', ...chapters().map((_, i) => `W${i + 1}`), '복습'];
    const sums = Object.fromEntries(labels.map((l) => [l, { a: 0, b: 0 }]));
    for (const s of S().sessions) {
      const k = bucket(s.dateKST);
      if (s.uid === me) sums[k].a += s.durationSec;
      else if (s.uid === fr) sums[k].b += s.durationSec;
    }
    for (const [uid, a] of Object.entries(S().active)) {
      const k = bucket(activeDate(a));
      if (uid === me) sums[k].a += activeElapsed(a);
      else if (uid === fr) sums[k].b += activeElapsed(a);
    }
    const shown = labels.filter((l) => (l !== '준비' || sums[l].a + sums[l].b > 0) && (l !== '복습' || curB === '복습' || sums[l].a + sums[l].b > 0));
    chart = barChart(shown.map((l) => ({ label: l.replace('W', ''), a: sums[l].a, b: sums[l].b, today: l === curB })), true);
  }

  const myT = secIn(me, from, to);
  const frT = secIn(fr, from, to);
  const comp = TYPES.map((t) => ({ t, sec: secIn(me, from, to, (s) => s.type === t) }));
  const compTotal = comp.reduce((x, y) => x + y.sec, 0);
  const compColors = ['#4168eb', '#8fb4ff', '#cbd8f4'];

  const inRange = (s) => (!from || s.dateKST >= from) && (!to || s.dateKST <= to);
  const recents = S().sessions.filter((s) => (s.uid === me || s.uid === fr) && inRange(s));
  const shownRecents = ui.showAllRecent ? recents : recents.slice(0, 5);

  return `
  ${head('THE NUMBERS', '학습 기록')}
  <div class="time-tabs">${[['today', '오늘'], ['week', '이번 주'], ['all', '전체']].map(([k, l]) => `<button class="${ui.statsRange === k ? 'active' : ''}" data-action="s-range" data-range="${k}">${l}</button>`).join('')}</div>
  <div class="recordcard" style="margin-top:18px">
    <div class="row"><span class="strong" style="font-size:15px">${title}</span><span class="mini muted">${rangeNote}</span></div>
    <div class="statpair"><div><span class="mini c-me">● 나</span><strong>${smallHM(myT)}</strong></div><div><span class="mini c-fr">● ${esc(friendName())}</span><strong>${smallHM(frT)}</strong></div></div>
    ${chart}
    <div class="chartlegend"><span class="c-me">● 나</span><span style="color:var(--fr-bar)">● ${esc(friendName())}</span></div>
  </div>
  <div class="recordcard" style="margin-top:14px">
    <div class="row"><span class="section-label">나의 공부 구성</span><span class="mini muted">총 ${hmText(compTotal)}</span></div>
    <div class="strip">${compTotal ? comp.map((c, i) => `<div style="width:${(c.sec / compTotal) * 100}%;background:${compColors[i]}"></div>`).join('') : ''}</div>
    ${comp.map((c, i) => `<div class="keyrow"><span><span style="color:${compColors[i]}">●</span> ${c.t} ${hmText(c.sec)}</span><b>${compTotal ? Math.round((c.sec / compTotal) * 100) : 0}%</b></div>`).join('')}
  </div>
  <div class="row" style="margin-top:22px"><span class="section-label">최근 기록</span>${recents.length > 5 ? `<button class="mini muted" data-action="s-all">${ui.showAllRecent ? '접기' : `모두 보기 (${recents.length}) →`}</button>` : ''}</div>
  <div class="recent">${shownRecents.length ? shownRecents.map((s) => {
      const c = chapterByNo(s.chapter);
      const mine = s.uid === me;
      return `<div class="recent-item"><span class="dot ${mine ? 'me' : 'fr'}"></span><div class="grow"><b>${esc(s.type)} · ${esc(c?.title || '')}</b><div class="mini muted">${mine ? '' : esc(friendName()) + ' · '}${dateLabel(s.dateKST).replace(/ \(.\)/, '')} · ${kstHHMM(s.startAt)}–${kstHHMM(s.endAt)}</div></div><b>${hmText(s.durationSec)}</b>${mine ? `<button class="del" data-action="s-del" data-id="${esc(s.id)}" aria-label="삭제">×</button>` : '<span style="width:20px"></span>'}</div>`;
    }).join('') : '<div class="empty-note" style="padding:14px 0">아직 기록이 없어요.</div>'}</div>`;
}

function barChart(cols, narrow = false) {
  const max = Math.max(1, ...cols.flatMap((c) => [c.a, c.b]));
  // 보기 좋은 상한(30분 단위)
  const top = Math.ceil(max / 1800) * 1800;
  const h = (v) => (v > 0 ? Math.max(3, (v / top) * 120) : 0);
  return `<div class="chart"><div class="chart-grid"></div>${cols.map((c) => `<div class="barcol ${c.today ? 'today' : ''}"><div class="barpair"><div style="height:${h(c.a)}px;background:var(--me)${narrow && cols.length > 9 ? ';width:8px' : ''}" title="나 ${hmText(c.a)}"></div><div style="height:${h(c.b)}px;background:var(--fr-bar)${narrow && cols.length > 9 ? ';width:8px' : ''}" title="${esc(friendName())} ${hmText(c.b)}"></div></div><span>${c.label}</span></div>`).join('')}</div>`;
}

// ───────────────── 설정 시트 ─────────────────
function openSettings() {
  const r = S().room;
  const myName = S().members[meId()]?.name || '';
  const wrap = document.createElement('div');
  wrap.className = 'sheet-back';
  wrap.innerHTML = `<div class="sheet" role="dialog" aria-label="설정">
    <div class="grab"></div>
    <h2>설정</h2>
    <label>내 이름 <span class="muted" style="font-weight:600">(친구 화면에 표시)</span></label>
    <input class="field" id="set-name" maxlength="10" placeholder="예: 불리" value="${esc(myName)}">
    <div class="two">
      <div><label>시험일</label><input class="field" type="date" id="set-exam" value="${esc(r.examDate)}"></div>
      <div><label>커리큘럼 시작일</label><input class="field" type="date" id="set-start" value="${esc(r.curriculumStart)}"></div>
    </div>
    <div class="hint">시작일부터 매주(7일) 1챕터씩 진행돼요. 챕터가 끝나면 시험 전날까지 '최종 복습 기간'.</div>
    <label>챕터 · 개념서 단원</label>
    <textarea class="field" id="set-chapters" spellcheck="false">${esc(chaptersToText(chapters()))}</textarea>
    <div class="hint">형식: <b>번호 | 챕터명 | 페이지</b>, 아래 줄에 <b>- 단원명</b>. 개념서 목차의 대단원 번호 순서대로 적어주세요.<br>⚠ 이미 체크한 단원은 '순서'로 기억돼요. 중간에 단원을 끼워 넣으면 체크가 밀릴 수 있어요.</div>
    <button class="btn-block" style="width:100%;margin-top:18px" id="set-save">저장</button>
    <button class="btn-line" id="set-close">닫기</button>
    <button class="btn-line" id="set-logout" style="color:var(--fr-strong)">${isDemo ? '데모 데이터 초기화' : '로그아웃'}</button>
    <div class="foot">${isDemo ? '데모 모드 · 이 기기에만 저장돼요' : esc(S().user?.email || '')} · v${VERSION}<br>시험일·시작일·챕터는 두 사람이 같이 써요.</div>
  </div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  wrap.querySelector('#set-close').onclick = close;
  wrap.querySelector('#set-logout').onclick = async () => { close(); await store.logout(); };
  wrap.querySelector('#set-save').onclick = async () => {
    const name = wrap.querySelector('#set-name').value.trim();
    const examDate = wrap.querySelector('#set-exam').value;
    const curriculumStart = wrap.querySelector('#set-start').value;
    const chs = textToChapters(wrap.querySelector('#set-chapters').value);
    if (!examDate || !curriculumStart) return toast('날짜를 입력해 주세요');
    if (!chs.length) return toast('챕터를 최소 1개 입력해 주세요');
    if (new Set(chs.map((c) => c.no)).size !== chs.length) return toast('챕터 번호가 겹쳐요');
    try {
      if (name !== myName) await store.updateMyName(name);
      await store.updateRoom({ examDate, curriculumStart, chapters: chs });
      toast('저장했어요');
      close();
    } catch (e) { handleError(e); }
  };
}

// ───────────────── 로그인 ─────────────────
function renderLogin() {
  $app.dataset.tab = 'home';
  $app.innerHTML = `<div class="login">
    <div class="smallbrand">STUDY DUO</div>
    <div class="app-title">우리의 공부<span class="dot-end">.</span></div>
    <div class="muted" style="margin-top:10px;font-size:13.5px">스포츠영양코치 2인 스터디</div>
    <form id="login-form">
      <input class="field" type="email" id="email" placeholder="이메일" autocomplete="username" required>
      <input class="field" type="password" id="pw" placeholder="비밀번호" autocomplete="current-password" required>
      <div class="form-err" id="err"></div>
      <button class="btn-block" type="submit">로그인</button>
    </form>
    <div class="muted mini" style="margin-top:18px;line-height:1.6">계정은 Firebase 콘솔에서 만든 이메일/비밀번호로 로그인해요.</div>
  </div>`;
  const form = document.getElementById('login-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button');
    btn.disabled = true;
    document.getElementById('err').textContent = '';
    try {
      await store.login(form.email.value, form.pw.value);
    } catch (err) {
      document.getElementById('err').textContent = errorText(err);
      btn.disabled = false;
    }
  };
}

// ───────────────── 렌더 루프 ─────────────────
let lastShell = '';
function render() {
  const st = S();
  if (!st.authReady) { $app.innerHTML = '<div class="boot">불러오는 중…</div>'; return; }
  if (!st.user) { if (lastShell !== 'login') { lastShell = 'login'; renderLogin(); } return; }
  if (!st.roomLoaded || !st.room) { $app.innerHTML = '<div class="boot">데이터 연결 중…</div>'; lastShell = 'boot'; return; }
  lastShell = 'app';

  const chipsScroll = document.getElementById('chips')?.scrollLeft;
  const y = window.scrollY;
  let body;
  if (ui.tab === 'timer') body = renderTimer();
  else if (ui.tab === 'progress') body = renderProgress();
  else if (ui.tab === 'stats') body = renderStats();
  else body = renderHome();

  const myActive = S().active[meId()];
  $app.dataset.tab = ui.tab;
  $app.innerHTML = `${isDemo ? `<div class="demo-bar">데모 모드 · 이 기기에만 저장돼요 · Firebase 연결 전${params.get('sample') === '1' ? ' · 시연 데이터' : ''}</div>` : ''}
  <div class="screen">${body}</div>
  <nav class="nav">${[['home', '홈'], ['timer', '타이머'], ['progress', '진도'], ['stats', '기록']].map(([k, l]) => `<button class="${ui.tab === k ? 'active' : ''}" data-action="go" data-tab="${k}"><span class="${k === 'timer' && myActive && ui.tab !== 'timer' ? 'badge' : ''}">${ICONS[k]}</span><span>${l}</span></button>`).join('')}</nav>`;

  const chips = document.getElementById('chips');
  if (chips) {
    if (chipsScroll != null) chips.scrollLeft = chipsScroll;
    else chips.querySelector('.selected')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }
  if (Math.abs(window.scrollY - y) > 1) window.scrollTo(0, y);
  syncWakeLock();
}

// 1초마다 진행 중 숫자 갱신 (다시 그리지 않고 숫자만 바꿈)
let lastMinuteKey = '';
setInterval(() => {
  const st = S();
  if (!st.user || !st.room) return;
  const a = st.active[meId()];
  const clock = document.querySelector('[data-live="clock"]');
  if (clock) clock.textContent = clockText(activeElapsed(a));
  const cta = document.querySelector('[data-live="cta"]');
  if (cta && a) cta.textContent = `${a.paused ? '일시정지 중' : '공부 중'} · ${clockText(activeElapsed(a))}`;
  const tt = document.querySelector('[data-live="todayTotal"]');
  if (tt) tt.textContent = hmText(secIn(meId(), todayKST(), todayKST()));
  // 분이 바뀌거나 날짜가 바뀌면 홈/기록 숫자 다시 그림
  const anyActive = Object.keys(st.active).length > 0;
  const key = `${todayKST()}|${anyActive ? Math.floor(nowMs() / 60000) : ''}`;
  if (key !== lastMinuteKey) {
    const first = !lastMinuteKey;
    lastMinuteKey = key;
    if (!first && ui.tab !== 'timer' && !document.querySelector('.sheet-back')) render();
  }
}, 1000);

// ───────────────── 이벤트 ─────────────────
$app.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const act = el.dataset.action;
  try {
    switch (act) {
      case 'go':
        ui.tab = el.dataset.tab;
        history.replaceState(null, '', '#' + ui.tab);
        window.scrollTo(0, 0);
        render();
        break;
      case 'open-settings':
        openSettings();
        break;
      case 't-type':
        ui.timerType = el.dataset.type; savePref(); render();
        break;
      case 't-start':
        await store.startTimer({ type: ui.timerType, chapter: timerChapter() });
        break;
      case 't-pause':
        await store.pauseTimer();
        break;
      case 't-resume':
        await store.resumeTimer();
        break;
      case 't-stop':
        await stopFlow();
        break;
      case 't-discard':
        if (confirm('이번 세션을 기록하지 않고 취소할까요?')) await store.discardTimer();
        break;
      case 't-wake':
        ui.wake = !ui.wake; savePref(); render();
        if (ui.wake && !('wakeLock' in navigator)) toast('이 브라우저는 화면 켜두기를 지원하지 않아요');
        break;
      case 'p-ch':
        ui.progCh = Number(el.dataset.ch); render();
        break;
      case 'p-book':
        ui.progBook = el.dataset.book; render();
        break;
      case 'p-concept': {
        const i = Number(el.dataset.i);
        const list = [...(S().progress[meId()]?.concept?.[ui.progCh] || [])];
        const at = list.indexOf(i);
        if (at >= 0) list.splice(at, 1); else list.push(i);
        list.sort((a, b) => a - b);
        await store.setConcept(ui.progCh, list);
        break;
      }
      case 'p-wb': {
        const k = el.dataset.key;
        await store.setWorkbook(ui.progCh, k, !workbookOf(meId(), ui.progCh)[k]);
        break;
      }
      case 's-range':
        ui.statsRange = el.dataset.range; ui.showAllRecent = false; savePref(); render();
        break;
      case 's-all':
        ui.showAllRecent = !ui.showAllRecent; render();
        break;
      case 's-del':
        if (confirm('이 기록을 삭제할까요? 친구 화면에서도 사라져요.')) await store.deleteSession(el.dataset.id);
        break;
    }
  } catch (err) {
    handleError(err);
  }
});

$app.addEventListener('change', (e) => {
  if (e.target.matches('[data-action="t-chapter"]')) {
    ui.timerCh = Number(e.target.value);
    ui.timerChWeek = currentChapterNo();
    savePref();
    render();
  }
});

async function stopFlow() {
  const a = S().active[meId()];
  if (!a) return;
  const sec = activeElapsed(a);
  if (sec < 60) {
    if (confirm('1분 미만은 저장되지 않아요. 종료할까요?')) await store.discardTimer();
    return;
  }
  let override;
  if (sec > 4 * 3600) {
    // 타이머 끄는 걸 깜빡한 경우 대비
    const ans = prompt(`${hmText(sec)}가 기록돼요. 맞으면 확인, 고치려면 실제 공부한 '분'을 입력하세요.`, String(Math.floor(sec / 60)));
    if (ans === null) return;
    const m = parseInt(ans, 10);
    if (Number.isNaN(m) || m < 1) return toast('숫자로 입력해 주세요');
    override = m * 60;
  }
  const dur = await store.stopTimer(override);
  if (dur != null) toast(`${hmText(dur)} 저장했어요`);
}

// ───────────────── 화면 켜두기 ─────────────────
let wakeSentinel = null;
async function syncWakeLock() {
  const want = ui.wake && ui.tab === 'timer' && S().active?.[meId()] && !S().active[meId()].paused && document.visibilityState === 'visible';
  try {
    if (want && !wakeSentinel && 'wakeLock' in navigator) {
      wakeSentinel = await navigator.wakeLock.request('screen');
      wakeSentinel.addEventListener('release', () => { wakeSentinel = null; });
    } else if (!want && wakeSentinel) {
      await wakeSentinel.release();
      wakeSentinel = null;
    }
  } catch (e) { wakeSentinel = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S().user) render();
});

// ───────────────── 오류/토스트 ─────────────────
function errorText(err) {
  const c = err?.code || '';
  if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found') || c.includes('invalid-email')) return '이메일 또는 비밀번호가 틀렸어요';
  if (c.includes('too-many-requests')) return '시도가 너무 많아요. 잠시 후 다시 해주세요';
  if (c.includes('network')) return '인터넷 연결을 확인해 주세요';
  if (c.includes('permission-denied')) return '권한이 없어요. Firestore 규칙에 이 이메일이 들어있는지 확인해 주세요';
  return err?.message || '알 수 없는 오류';
}
function handleError(err) {
  console.error(err);
  toast(errorText(err));
}
let toastTimer;
function toast(msg) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 2600);
}
store.onError(handleError);

// ───────────────── 시작 ─────────────────
store.subscribe(render);
window.addEventListener('hashchange', () => {
  const t = location.hash.slice(1);
  if (['home', 'timer', 'progress', 'stats'].includes(t) && t !== ui.tab) { ui.tab = t; window.scrollTo(0, 0); render(); }
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
