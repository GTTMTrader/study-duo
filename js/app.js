import { firebaseConfig } from './config.js';
import { TYPES, PRACTICE_COUNT, SCHEMA, chaptersToText, textToChapters, fillChapterDates } from './defaults.js';
import {
  nowMs, todayKST, setTodayOverride, kstHHMM, daysBetween, addDays, mondayOf, weekdayIdx,
  dateLabel, shortDate, getPhase, kstDateStr, splitHM, hmText, clockText,
} from './dates.js';
import { deviceLabel } from './device.js';
import { SKINS, getSkin, setSkin } from './skin.js';

const VERSION = '1.4.1';
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
  tab: ['home', 'quiz', 'timer', 'progress', 'stats'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home',
  statsRange: pref.statsRange || 'week',
  progCh: null,
  progBook: 'concept',
  pracWho: 'me',
  quizCh: null,
  quizTab: 'make',
  quizSolve: null,
  quizRetry: false,
  quizJust: null,
  wrongAll: false,
  calMonth: null,
  calSel: null,
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
const myName = () => S().members?.[meId()]?.name || '나';
const friendName = () => {
  const f = friendId();
  return (f && S().members[f]?.name) || '친구';
};
let _chMemo = { room: null, list: [] };
const chapters = () => {
  const r = S().room;
  if (!r) return [];
  if (_chMemo.room !== r) _chMemo = { room: r, list: fillChapterDates(r.chapters || [], r.curriculumStart) };
  return _chMemo.list;
};
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

// 현재 단계: 챕터별 날짜(시작~끝) 기준
function phaseNow() {
  const r = S().room;
  const today = todayKST();
  const chs = chapters();
  const dExam = daysBetween(today, r.examDate);
  if (dExam < 0) return { kind: 'done', dExam };
  if (dExam === 0) return { kind: 'exam', dExam };
  const idx = chs.findIndex((c) => c.start <= today && today <= c.end);
  if (idx >= 0) return { kind: 'week', dExam, week: idx + 1 };
  const nextIdx = chs.findIndex((c) => c.start > today);
  if (nextIdx === 0) return { kind: 'before', dExam, week: 1, daysToStart: daysBetween(today, chs[0].start) };
  if (nextIdx > 0) return { kind: 'week', dExam, week: nextIdx }; // 챕터 사이 빈 날 → 직전 챕터
  return { kind: 'review', dExam };
}
const WDK = ['일', '월', '화', '수', '목', '금', '토'];
function mdw(s) {
  const d = new Date(s + 'T00:00:00Z');
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} (${WDK[d.getUTCDay()]})`;
}
// 기존 데이터 1회 변환: 커리큘럼 10/26 시작 + 챕터별 날짜 저장
let migrating = false;
function maybeMigrate() {
  const r = S().room;
  if (!r || migrating || (r.schema || 1) >= SCHEMA) return;
  migrating = true;
  const base = r.chapters.map(({ start, end, ...c }) => c);
  store.updateRoom({ curriculumStart: '2026-10-26', chapters: fillChapterDates(base, '2026-10-26'), schema: SCHEMA })
    .catch(handleError)
    .finally(() => { migrating = false; });
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
  quiz: '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .8-1 1.5v.5M12 16.8h.01"/></svg>',
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
// 시간 대신: 문제 정답 대결 + 이번 주 할 일
function renderHome() {
  const me = meId();
  const fr = friendId();
  const p = phaseNow();

  // 상단 주차 표시
  let pillText, metaText = '';
  if (p.kind === 'week' || p.kind === 'before') {
    const ch = chapters()[(p.week || 1) - 1];
    pillText = p.kind === 'before' ? `시작 D-${p.daysToStart}` : `WEEK ${String(p.week).padStart(2, '0')}`;
    if (ch) metaText = `${esc(ch.title)}${ch.pages ? ` <span style="color:var(--faint);padding:0 5px">·</span> ${esc(ch.pages)}` : ''}`;
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

  // 이번 주 챕터 (복습 기간·시험 이후엔 전체)
  const weekCh = p.kind === 'week' || p.kind === 'before' ? chapters()[(p.week || 1) - 1] : null;
  const chs = weekCh ? [weekCh] : chapters();
  const tally = (uid, other) => chs.reduce((t, c) => {
    const st = quizStats(uid, other, c.no);
    t.made += st.made; t.solved += st.solved; t.right += st.right; t.otherMade += st.otherMade;
    return t;
  }, { made: 0, solved: 0, right: 0, otherMade: 0 });
  const mt = tally(me, fr);
  const ft = tally(fr, me);

  // 정답 대결
  const myS = mt.right, frS = ft.right, total = myS + frS;
  const myPct = total ? Math.max(4, Math.min(96, (myS / total) * 100)) : 50;
  const diff = Math.abs(myS - frS);
  let msg, msgCls = '';
  if (!mt.solved && !ft.solved) { msg = '아직 푼 문제가 없어요'; msgCls = 'even'; }
  else if (!diff) { msg = '지금은 동점이에요'; msgCls = 'even'; }
  else if (myS > frS) msg = `${diff}문제 앞서 있어요`;
  else { msg = `${diff}문제 뒤처져 있어요`; msgCls = 'behind'; }
  const leader = diff ? (myS > frS ? 'me' : 'fr') : null;
  const big = (n) => `<div class="score">${n}<span class="unit">문제</span></div>`;
  const N = PRACTICE_COUNT * chs.length;

  // 이번 주 할 일
  const sumBy = (fn) => chs.reduce((t, c) => t + fn(c), 0);
  const rows = [
    ['개념서 단원', sumBy((c) => conceptDone(me, c.no)), sumBy((c) => conceptDone(fr, c.no)), sumBy((c) => c.topics.length)],
    ['문제집', sumBy((c) => { const w = workbookOf(me, c.no); return (w.solved ? 1 : 0) + (w.wrong ? 1 : 0); }), sumBy((c) => { const w = workbookOf(fr, c.no); return (w.solved ? 1 : 0) + (w.wrong ? 1 : 0); }), 2 * chs.length],
    ['문제 만들기', mt.made, ft.made, N],
    ['상대 문제 풀기', mt.solved, ft.solved, [mt.otherMade, ft.otherMade]],
  ];
  const cell = (v, n, cls) => `<div class="todo-cell"><div class="progress-track"><div class="progress-fill" style="width:${n ? Math.min(100, (v / n) * 100) : 0}%;background:var(--${cls})"></div></div><b>${v}/${n}</b></div>`;
  const todo = rows.map(([label, a, b, n]) => {
    const [na, nb] = Array.isArray(n) ? n : [n, n];
    return `<div class="todo-row"><span class="todo-lbl">${label}</span>${cell(a, na, 'me')}${cell(b, nb, 'fr')}</div>`;
  }).join('');

  const left = unsolvedCount();
  const cta = left
    ? `<button data-action="go-quiz" data-qtab="solve">▶&nbsp; ${esc(friendName())} 문제 풀기 · ${left}개 <span class="arrow">→</span></button>`
    : `<button data-action="go-quiz" data-qtab="make">✎&nbsp; 이번 주 문제 만들기 <span class="arrow">→</span></button>`;

  return `
  ${head('STUDY DUO', '우리의 공부<span class="dot-end">.</span>', ddayBadge())}
  <div class="row meta-row"><span class="pill blue">${pillText}</span><div class="muted mini">${metaText}</div></div>
  <div class="duel">
    <div class="row" style="margin-bottom:14px"><span class="eyebrow">THIS WEEK'S RACE</span><span class="pill">${weekCh ? `Ch${weekCh.no} 정답 대결` : '전체 정답 대결'}</span></div>
    <div class="row" style="align-items:flex-end">
      <div><div class="who"><span class="dot me"></span>${esc(myName())}${leader === 'me' ? ' <span>🏅</span>' : ''}</div>${big(myS)}<div class="score-sub">푼 문제 ${mt.solved}/${mt.otherMade}</div></div>
      <div style="text-align:right"><div class="who" style="justify-content:flex-end"><span class="dot fr"></span>${esc(friendName())}${leader === 'fr' ? ' <span>🏅</span>' : ''}</div>${big(frS)}<div class="score-sub">푼 문제 ${ft.solved}/${ft.otherMade}</div></div>
    </div>
    <div class="race-track">${total ? `<div style="background:var(--me);width:${myPct}%"></div><div style="background:var(--fr-bar);width:${100 - myPct}%"></div>` : '<div style="width:100%;background:var(--track)"></div>'}</div>
    <div class="row" style="margin-top:14px"><span class="race-msg ${msgCls}">${msg}</span><span class="mini muted">${weekCh ? `${shortDate(weekCh.start)}–${shortDate(weekCh.end)}` : '전체 챕터'}</span></div>
  </div>
  ${!fr ? `<div class="empty-note" style="margin-top:10px;text-align:center">${isDemo ? '' : '상대가 아직 한 번도 로그인하지 않았어요.'}</div>` : ''}
  <div class="row sec-row" style="margin-bottom:10px"><span class="section-label">${weekCh ? '이번 주 할 일' : '전체 진행'}</span><span class="mini muted">${weekCh ? `Chapter ${weekCh.no}` : `${chs.length}개 챕터`}</span></div>
  <div class="card todo-card">
    <div class="todo-row todo-head"><span></span><span class="c-me">● ${esc(myName())}</span><span class="c-fr">● ${esc(friendName())}</span></div>
    ${todo}
  </div>
  <div class="cta">${cta}</div>`;
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
    ? mineToday.map((s) => `<button class="session editable" data-action="edit-session" data-id="${esc(s.id)}"><span style="color:var(--muted-2)">${kstHHMM(s.startAt)}–${kstHHMM(s.endAt)}</span><span>${esc(s.type)}</span><b>${hmText(s.durationSec)}</b><i class="chev-r">›</i></button>`).join('') + `<div class="hint-row">기록을 누르면 시간 수정·삭제할 수 있어요</div>`
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
    <div class="row"><span style="font-size:13px;color:var(--muted);font-weight:750">오늘 누적 · 진행 중 포함</span><span style="font-size:22px;font-weight:900" data-live="todayTotal">${hmText(secIn(me, today, today))}</span></div>
    <div class="separator"></div>
    <div class="row"><span style="font-size:14px;color:var(--ink-2);font-weight:750">저장된 세션</span><span class="mini" style="color:var(--muted-2)">${mineToday.length}개</span></div>
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
    .map((c) => `<button class="weekitem ${c.no === ui.progCh ? 'selected' : ''} ${c.no === cur ? 'now' : ''}" data-action="p-ch" data-ch="${c.no}">${String(c.no).padStart(2, '0')}<small>${esc(c.title)}</small><em>${shortDate(c.start)}–${shortDate(c.end)}</em></button>`)
    .join('');
  if (!ch) return `${head('KEEP GOING', '학습 진도')}<div class="card empty-note">챕터가 없어요. 설정에서 입력해 주세요.</div>`;

  let body;
  if (ui.progBook === 'concept') {
    const n = ch.topics.length;
    const mine = S().progress[me]?.concept?.[ch.no] || [];
    const theirs = S().progress[fr]?.concept?.[ch.no] || [];
    body = n
      ? `<div class="mini-progress"><div><span class="c-me">● ${esc(myName())}</span><b>${conceptDone(me, ch.no)} / ${n}</b></div><div><span class="c-fr">● ${esc(friendName())}</span><b>${conceptDone(fr, ch.no)} / ${n}</b></div></div>
        <div class="listhead"><span>학습 항목</span><span>${esc(myName().slice(0, 3))}</span><span>${esc(friendName().slice(0, 3))}</span></div>
        ${ch.topics.map((t, i) => `<div class="topic"><div><span class="num">${i + 1}.</span>${esc(t)}</div>
          <button class="check ${mine.includes(i) ? 'on' : ''}" data-action="p-concept" data-i="${i}" aria-label="${esc(t)} 완료">${`<span>${mine.includes(i) ? ICONS.check : ''}</span>`}</button>
          <span class="check fr ${theirs.includes(i) ? 'on' : ''}">${theirs.includes(i) ? ICONS.check : ''}</span></div>`).join('')}`
      : `<div class="card empty-note" style="margin-top:14px">이 챕터의 단원 목록이 아직 없어요.<br>개념서 목차 사진 보고 <button class="linkish" data-action="open-settings">설정</button>에서 단원을 입력해 주세요.</div>`;
  } else if (ui.progBook === 'practice') {
    body = renderPractice(ch, me, fr);
  } else {
    const mw = workbookOf(me, ch.no);
    const fw = workbookOf(fr, ch.no);
    const cnt = (w) => (w.solved ? 1 : 0) + (w.wrong ? 1 : 0);
    const row = (key, label) => `<div class="topic"><div>${label}</div>
      <button class="check ${mw[key] ? 'on' : ''}" data-action="p-wb" data-key="${key}" aria-label="${label}"><span>${mw[key] ? ICONS.check : ''}</span></button>
      <span class="check fr ${fw[key] ? 'on' : ''}">${fw[key] ? ICONS.check : ''}</span></div>`;
    body = `<div class="mini-progress"><div><span class="c-me">● ${esc(myName())}</span><b>${cnt(mw)} / 2</b></div><div><span class="c-fr">● ${esc(friendName())}</span><b>${cnt(fw)} / 2</b></div></div>
      <div class="listhead"><span>문제집</span><span>${esc(myName().slice(0, 3))}</span><span>${esc(friendName().slice(0, 3))}</span></div>
      ${row('solved', '풀이 완료')}${row('wrong', '오답 정리')}
      <div class="practice-hint"><b>문제집은 간단하게.</b><span>풀이 완료 · 오답 정리 완료만 체크</span></div>`;
  }

  return `
  ${head('KEEP GOING', '학습 진도')}
  <div class="week-scroll" id="chips">${chips}</div>
  <div class="row chap-head"><div><div class="chap-no">CHAPTER ${String(ch.no).padStart(2, '0')}</div><div class="chap-title">${esc(ch.title)}</div></div><div class="muted" style="font-size:13px">${esc(ch.pages)}</div></div>
  <button class="date-chip" data-action="p-dates" aria-label="챕터 날짜 수정">${mdw(ch.start)} ~ ${mdw(ch.end)}<span class="pen">✎ 수정</span></button>
  <div class="booktabs">${[['concept', '개념서'], ['workbook', '문제집'], ['practice', '연습문제']].map(([k, l]) => `<button class="${ui.progBook === k ? 'active' : ''}" data-action="p-book" data-book="${k}">${l}</button>`).join('')}</div>
  ${body}`;
}

// 연습문제: 각자 챕터당 10문제 — 제작 / 풀이 / 오답
const PRAC_KEYS = [['made', '제작'], ['solved', '풀이'], ['wrong', '오답']];
// 문제 탭 데이터에서 자동으로 계산 (직접 체크 X)
function practiceOf(uid, chNo) {
  const other = uid === meId() ? friendId() : meId();
  const made = [], solved = [], wrong = [];
  for (let i = 0; i < PRACTICE_COUNT; i++) {
    if (qOf(uid, chNo, i)) made.push(i);
    const a = ansOf(uid, qOf(other, chNo, i));
    if (a) { solved.push(i); if (!a.correct) wrong.push(i); }
  }
  return { made, solved, wrong };
}
function renderPractice(ch, me, fr) {
  const N = PRACTICE_COUNT;
  const mp = practiceOf(me, ch.no);
  const fp = practiceOf(fr, ch.no);
  const cnt = (list) => list.filter((i) => i < N).length;
  const card = (p, name, cls) => `<div class="prac-card"><span class="${cls}">● ${esc(name)}</span>
    ${PRAC_KEYS.map(([k, l]) => `<div class="prac-line"><span>${l}</span><div class="progress-track"><div class="progress-fill" style="width:${(cnt(p[k]) / N) * 100}%;background:var(--${cls === 'c-me' ? 'me' : 'fr'})${k === 'wrong' ? ';opacity:.45' : ''}"></div></div><b>${cnt(p[k])}${k === 'wrong' ? '' : `/${N}`}</b></div>`).join('')}</div>`;
  const viewMe = ui.pracWho !== 'fr' || !fr;
  const p = viewMe ? mp : fp;
  const rows = Array.from({ length: N }, (_, i) => `<div class="topic four"><div><span class="num">Q${i + 1}</span></div>
    ${PRAC_KEYS.map(([k]) => `<span class="check ${viewMe ? 'me' : 'fr'} ${p[k].includes(i) ? 'on' : ''}">${p[k].includes(i) ? ICONS.check : ''}</span>`).join('')}</div>`).join('');
  return `<div class="prac-sum">${card(mp, myName(), 'c-me')}${card(fp, friendName(), 'c-fr')}</div>
    <div class="who-tabs"><button class="${viewMe ? 'active' : ''}" data-action="p-who" data-who="me">${esc(myName())} 체크</button><button class="${!viewMe ? 'active fr' : ''}" data-action="p-who" data-who="fr" ${fr ? '' : 'disabled'}>${esc(friendName())} 체크</button></div>
    <div class="listhead four"><span>문제</span><span>제작</span><span>풀이</span><span>오답</span></div>
    ${rows}
    <div class="practice-hint"><b>문제 탭에서 자동으로 체크돼요.</b><span>문제 만들면 제작 · 상대 문제 풀면 풀이 · 처음에 틀리면 오답</span></div>
    <button class="btn-line" style="margin-top:12px" data-action="go-quiz" data-qtab="make">문제 탭으로 가기 →</button>`;
}


// ───────────────── 문제은행 ─────────────────
// 챕터마다 각자 5지선다 10문제 → 상대 문제 풀기 → 자동 채점 → 오답노트
const CIRCLED = ['①', '②', '③', '④', '⑤'];
const qKey = (uid, ch, slot) => `${uid}_${ch}_${slot}`;
const qOf = (uid, ch, slot) => (uid ? S().questions?.[qKey(uid, ch, slot)] : undefined);
const ansOf = (solver, q) => (solver && q ? S().answers?.[`${solver}_${q.id}`] : undefined);
function partnerQs(chNo = null) {
  const fr = friendId();
  return Object.values(S().questions || {})
    .filter((q) => q.author === fr && (chNo == null || q.chapter === chNo))
    .sort((a, b) => a.chapter - b.chapter || a.slot - b.slot);
}
function unsolvedCount(chNo = null) {
  return partnerQs(chNo).filter((q) => !ansOf(meId(), q)).length;
}

function chipsHTML(sel, action) {
  const cur = currentChapterNo();
  return `<div class="week-scroll" id="chips">${chapters()
    .map((c) => `<button class="weekitem ${c.no === sel ? 'selected' : ''} ${c.no === cur ? 'now' : ''}" data-action="${action}" data-ch="${c.no}">${String(c.no).padStart(2, '0')}<small>${esc(c.title)}</small><em>${shortDate(c.start)}–${shortDate(c.end)}</em></button>`)
    .join('')}</div>`;
}

function quizStats(uid, other, chNo) {
  const N = PRACTICE_COUNT;
  let made = 0, otherMade = 0, solved = 0, right = 0;
  for (let i = 0; i < N; i++) {
    if (qOf(uid, chNo, i)) made++;
    const oq = qOf(other, chNo, i);
    if (oq) {
      otherMade++;
      const a = ansOf(uid, oq);
      if (a) { solved++; if (a.correct) right++; }
    }
  }
  return { made, otherMade, solved, right };
}

function renderQuiz() {
  const me = meId();
  const fr = friendId();
  if (ui.quizCh == null || !chapterByNo(ui.quizCh)) ui.quizCh = currentChapterNo() ?? chapters()[0]?.no;
  if (ui.quizSolve) return renderSolve();
  const ch = chapterByNo(ui.quizCh);
  if (!ch) return `${head('QUIZ BANK', '문제은행')}<div class="card empty-note">챕터가 없어요.</div>`;
  const N = PRACTICE_COUNT;
  const ms = quizStats(me, fr, ch.no);
  const fs = quizStats(fr, me, ch.no);
  const sumCard = (st, name, cls) => `<div class="prac-card"><span class="${cls}">● ${esc(name)}</span>
    <div class="q-sum-line"><span>만든 문제</span><b>${st.made}/${N}</b></div>
    <div class="q-sum-line"><span>푼 문제</span><b>${st.solved}/${st.otherMade}</b></div>
    <div class="q-sum-line"><span>정답</span><b>${st.right}${st.solved ? ` <small>(${Math.round((st.right / st.solved) * 100)}%)</small>` : ''}</b></div></div>`;

  const tab = ui.quizTab || 'make';
  let body = '';
  if (tab === 'solve') {
    if (!fr) body = `<div class="card empty-note" style="margin-top:14px">${esc(friendName())}가 아직 로그인하지 않았어요.</div>`;
    else {
      const left = unsolvedCount(ch.no);
      body = `${left ? `<button class="btn-block q-continue" data-action="q-continue">▶ 안 푼 문제 이어서 풀기 · ${left}개</button>` : ''}
      <div class="qlist">${Array.from({ length: N }, (_, i) => {
        const q = qOf(fr, ch.no, i);
        if (!q) return `<div class="qrow empty"><span class="qno">Q${i + 1}</span><span class="qtext">아직 안 만들었어요</span></div>`;
        const a = ansOf(me, q);
        const st = !a ? '<span class="qstat todo">풀기</span>' : a.correct ? '<span class="qstat ok">정답</span>' : `<span class="qstat bad">오답${a.lastCorrect ? '→✓' : ''}</span>`;
        return `<button class="qrow" data-action="q-open" data-id="${esc(q.id)}"><span class="qno">Q${i + 1}</span><span class="qtext">${esc(q.text)}</span>${st}</button>`;
      }).join('')}</div>`;
    }
  } else if (tab === 'make') {
    body = `<div class="qlist">${Array.from({ length: N }, (_, i) => {
      const q = qOf(me, ch.no, i);
      const a = ansOf(fr, q);
      const st = !q ? '' : !a ? '<span class="qstat todo">안 풂</span>' : a.correct ? `<span class="qstat ok">${esc(friendName().slice(0, 3))} ✓</span>` : `<span class="qstat bad">${esc(friendName().slice(0, 3))} ✗</span>`;
      return `<button class="qrow ${q ? '' : 'new'}" data-action="q-edit" data-slot="${i}"><span class="qno">Q${i + 1}</span><span class="qtext">${q ? esc(q.text) : '+ 문제 만들기'}</span>${st}</button>`;
    }).join('')}</div>
    <div class="practice-hint"><b>5지선다 · 챕터당 ${N}문제.</b><span>저장하면 ${esc(friendName())} 폰에 바로 떠요. 상대 결과(✓/✗)도 여기서 보여요.</span></div>`;
  } else {
    const list = Object.values(S().answers || {})
      .filter((a) => a.uid === me && a.correct === false && (ui.wrongAll || a.chapter === ch.no))
      .map((a) => ({ a, q: S().questions?.[a.qid] }))
      .filter((x) => x.q)
      .sort((x, y) => x.q.chapter - y.q.chapter || x.q.slot - y.q.slot);
    body = `<div class="row" style="margin-top:14px"><span class="mini muted">처음에 틀린 문제 ${list.length}개</span>
      <button class="filter-chip ${ui.wrongAll ? 'on' : ''}" data-action="q-wrongall">${ui.wrongAll ? '전체 챕터' : `Ch${ch.no}만`} ⇄</button></div>
      ${list.length ? list.map(({ a, q }) => `<div class="wrong-card">
        <div class="row"><b class="mini">Ch${q.chapter} · ${esc(friendName())} Q${q.slot + 1}</b>${a.lastCorrect ? '<span class="qstat ok">재도전 정답</span>' : '<span class="qstat bad">오답</span>'}</div>
        <p class="wq">${esc(q.text)}</p>
        <div class="wl bad">내 답 ${CIRCLED[a.choice]} ${esc(q.choices[a.choice])}</div>
        <div class="wl ok">정답 ${CIRCLED[q.answer]} ${esc(q.choices[q.answer])}</div>
        ${q.explanation ? `<div class="wexp">💡 ${esc(q.explanation)}</div>` : ''}
        <button class="btn-line" data-action="q-open" data-id="${esc(q.id)}" data-retry="1">다시 풀기</button></div>`).join('')
      : '<div class="card empty-note" style="margin-top:12px">틀린 문제가 없어요 👏</div>'}`;
  }

  return `
  ${head('QUIZ BANK', '문제은행')}
  ${chipsHTML(ch.no, 'q-ch')}
  <div class="prac-sum">${sumCard(ms, myName(), 'c-me')}${sumCard(fs, friendName(), 'c-fr')}</div>
  <div class="booktabs">${[['make', '내 문제'], ['solve', `${esc(friendName())} 문제`], ['wrong', '오답노트']].map(([k, l]) => `<button class="${tab === k ? 'active' : ''}" data-action="q-tab" data-qtab="${k}">${l}</button>`).join('')}</div>
  ${body}`;
}

function renderSolve() {
  const me = meId();
  const q = S().questions?.[ui.quizSolve];
  if (!q) { ui.quizSolve = null; return renderQuiz(); }
  const a = ansOf(me, q);
  const just = ui.quizJust && ui.quizJust.qid === q.id ? ui.quizJust : null;
  const showResult = !!just || (a && !ui.quizRetry);
  const picked = just ? just.choice : a ? a.lastChoice : null;
  const right = picked === q.answer;
  const next = partnerQs(q.chapter).find((x) => x.id !== q.id && !ansOf(me, x));
  const choices = q.choices.map((c, i) => {
    const cls = !showResult ? '' : i === q.answer ? 'right' : i === picked ? 'wrong' : 'dim';
    return `<button class="choice ${cls}" data-action="q-pick" data-i="${i}" ${showResult ? 'disabled' : ''}><span class="cn">${CIRCLED[i]}</span><span>${esc(c)}</span></button>`;
  }).join('');
  return `
  <div class="solve-top"><button class="back-btn" data-action="q-back">‹ 목록</button><span class="mini muted">Ch${q.chapter} · ${esc(friendName())}의 Q${q.slot + 1}</span></div>
  <div class="solve-card"><div class="solve-q">${esc(q.text)}</div></div>
  <div class="choices">${choices}</div>
  ${showResult ? `<div class="result ${right ? 'ok' : 'bad'}"><b>${right ? '정답이에요! 🎉' : `아쉬워요. 정답은 ${CIRCLED[q.answer]}`}</b>
    ${a && a.attempts > 1 ? `<span class="mini">처음 답: ${CIRCLED[a.choice]} · ${a.attempts}번째 도전</span>` : ''}
    ${q.explanation ? `<div class="wexp">💡 ${esc(q.explanation)}</div>` : ''}</div>
    <div class="confirm-row" style="margin-top:14px"><button class="btn-line" data-action="q-retry">다시 풀기</button>
    ${next ? `<button class="btn-block" data-action="q-open" data-id="${esc(next.id)}">다음 문제 →</button>` : '<button class="btn-block" data-action="q-back">목록으로</button>'}</div>`
  : '<div class="quiet">보기를 누르면 바로 채점돼요</div>'}`;
}

function confirmBox(title, msg, yes = '예', danger = false) {
  return new Promise((resolve) => {
    const c = document.createElement('div');
    c.className = 'confirm-back';
    c.style.zIndex = 40;
    c.innerHTML = `<div class="confirm-box" role="alertdialog"><b>${title}</b><p>${msg}</p>
      <div class="confirm-row"><button class="btn-line" data-c="no">아니오</button><button class="btn-block ${danger ? 'danger' : ''}" data-c="yes">${yes}</button></div></div>`;
    document.body.appendChild(c);
    c.addEventListener('click', (e) => {
      const b = e.target.closest('[data-c]');
      if (!b && e.target !== c) return;
      c.remove();
      resolve(b?.dataset.c === 'yes');
    });
  });
}

function openQuestionEditor(chNo, slot) {
  const me = meId();
  const q = qOf(me, chNo, slot);
  const fa = ansOf(friendId(), q);
  let answer = q ? q.answer : null;
  let dirty = false;
  const wrap = document.createElement('div');
  wrap.className = 'sheet-back';
  wrap.innerHTML = `<div class="sheet qe-sheet" role="dialog" aria-label="문제 편집">
    <div class="sheet-head"><div class="grab"></div><h2>Ch${chNo} · Q${slot + 1} ${q ? '수정' : '만들기'}</h2></div>
    <div class="sheet-body">
      <label>문제</label>
      <textarea class="field" id="qe-text" rows="4" placeholder="예: 다음 중 단당류가 아닌 것은?">${esc(q?.text || '')}</textarea>
      <label>보기 <span class="muted" style="font-weight:600">(정답 번호를 눌러 표시)</span></label>
      ${[0, 1, 2, 3, 4].map((i) => `<div class="choice-edit"><button class="ans-pick ${answer === i ? 'on' : ''}" data-pick="${i}" aria-label="${i + 1}번을 정답으로">${CIRCLED[i]}</button><input class="field" id="qe-c${i}" placeholder="보기 ${i + 1}" value="${esc(q?.choices?.[i] || '')}"></div>`).join('')}
      <label>해설 <span class="muted" style="font-weight:600">(선택)</span></label>
      <textarea class="field" id="qe-exp" rows="2" placeholder="틀렸을 때 보여줄 설명">${esc(q?.explanation || '')}</textarea>
      ${fa ? `<div class="hint">⚠ ${esc(friendName())}가 이미 푼 문제예요. 고쳐도 채점 결과는 그대로 남아요.</div>` : ''}
      ${q ? '<button class="text-btn" data-q="delete">이 문제 삭제</button>' : ''}
    </div>
    <div class="sheet-foot"><button class="btn-line" data-q="cancel">취소</button><button class="btn-block" data-q="save">저장</button></div>
  </div>`;
  document.body.appendChild(wrap);
  const unlock = lockBackground(wrap);
  requestAnimationFrame(() => wrap.classList.add('open'));
  const close = () => { wrap.classList.remove('open'); setTimeout(() => { wrap.remove(); unlock(); }, 220); };
  const tryClose = async () => { if (!dirty || (await confirmBox('저장하지 않고 닫을까요?', '쓴 내용이 사라져요.'))) close(); };
  wrap.addEventListener('input', () => { dirty = true; });
  wrap.addEventListener('click', async (e) => {
    if (e.target === wrap) return tryClose();
    const pick = e.target.closest('[data-pick]');
    if (pick) {
      answer = Number(pick.dataset.pick);
      dirty = true;
      wrap.querySelectorAll('.ans-pick').forEach((b) => b.classList.toggle('on', Number(b.dataset.pick) === answer));
      return;
    }
    const act = e.target.closest('[data-q]')?.dataset.q;
    if (!act) return;
    try {
      if (act === 'cancel') return tryClose();
      if (act === 'delete') {
        if (await confirmBox('이 문제를 삭제할까요?', `${esc(friendName())} 화면에서도 사라져요.`, '삭제', true)) {
          await store.deleteQuestion(q.id);
          close();
          toast('문제를 삭제했어요');
        }
        return;
      }
      if (act === 'save') {
        const text = wrap.querySelector('#qe-text').value.trim();
        const choices = [0, 1, 2, 3, 4].map((i) => wrap.querySelector(`#qe-c${i}`).value.trim());
        const explanation = wrap.querySelector('#qe-exp').value.trim();
        if (!text) return toast('문제를 입력해 주세요');
        if (choices.some((c) => !c)) return toast('보기 5개를 모두 입력해 주세요');
        if (answer == null) return toast('정답 번호를 눌러 표시해 주세요');
        await store.saveQuestion(chNo, slot, { text, choices, answer, explanation });
        close();
        toast(q ? '수정했어요' : `저장했어요 · ${friendName()} 폰에 바로 떠요`);
      }
    } catch (err) { handleError(err); }
  });
}

// 챕터 날짜 수정
function openChapterDates(chNo) {
  const chs = chapters();
  const idx = chs.findIndex((c) => c.no === chNo);
  if (idx < 0) return;
  const ch = chs[idx];
  const wrap = document.createElement('div');
  wrap.className = 'confirm-back';
  const unlock = lockBackground(wrap);
  const close = () => { wrap.remove(); unlock(); };
  wrap.innerHTML = `<div class="confirm-box edit-box" role="dialog" aria-label="챕터 날짜 수정">
    <b>Chapter ${String(ch.no).padStart(2, '0')} 날짜</b>
    <p>${esc(ch.title)}</p>
    <div class="two">
      <div><label>시작</label><input class="field" type="date" id="d-start" value="${ch.start}"></div>
      <div><label>끝</label><input class="field" type="date" id="d-end" value="${ch.end}"></div>
    </div>
    <label class="check-row"><input type="checkbox" id="d-shift" ${idx < chs.length - 1 ? 'checked' : 'disabled'}> 뒤 챕터들도 같이 밀기/당기기</label>
    <div class="hint">기본은 월요일 시작 · 일요일 끝 (1주). 시작을 바꾸면 끝은 6일 뒤로 맞춰져요.</div>
    <div class="confirm-row" style="margin-top:16px"><button class="btn-line" data-e="cancel">취소</button><button class="btn-block" data-e="save">저장</button></div>
  </div>`;
  document.body.appendChild(wrap);
  const $s = wrap.querySelector('#d-start'), $e = wrap.querySelector('#d-end');
  let lastStart = ch.start;
  $s.addEventListener('change', () => {
    if ($s.value && $e.value === addDays(lastStart, 6)) $e.value = addDays($s.value, 6);
    lastStart = $s.value || lastStart;
  });
  wrap.addEventListener('click', async (e) => {
    if (e.target === wrap) return close();
    const act = e.target.closest('[data-e]')?.dataset.e;
    if (act === 'cancel') return close();
    if (act !== 'save') return;
    const start = $s.value, end = $e.value;
    if (!start || !end) return toast('날짜를 입력해 주세요');
    if (end < start) return toast('끝 날짜가 시작보다 빨라요');
    const shift = wrap.querySelector('#d-shift').checked ? daysBetween(ch.end, end) : 0;
    const next = chs.map((c, i) => {
      if (i === idx) return { ...c, start, end };
      if (i > idx && shift) return { ...c, start: addDays(c.start, shift), end: addDays(c.end, shift) };
      return c;
    });
    try {
      await store.updateRoom({ chapters: next });
      close();
      toast('날짜를 저장했어요');
    } catch (err) { handleError(err); }
  });
}

// ───────────────── 기록 ─────────────────
// 시간 없이: 챕터별 현황 + 달력(문제 만들기·풀기·진도 활동)
function statsTabs() {
  return `<div class="time-tabs">${[['chapters', '챕터별'], ['cal', '달력']].map(([k, l]) => `<button class="${ui.statsRange === k ? 'active' : ''}" data-action="s-range" data-range="${k}">${l}</button>`).join('')}</div>`;
}

// 날짜 → {uid|챕터|종류: {uid, chapter, kind, n, right}}
function activityByDate(me, fr, from, to) {
  const out = {};
  const add = (date, uid, chapter, kind, right) => {
    if (!date || date < from || date > to || (uid !== me && uid !== fr)) return;
    const day = (out[date] ||= {});
    const e = (day[`${uid}|${chapter}|${kind}`] ||= { uid, chapter, kind, n: 0, right: 0 });
    e.n++;
    if (right) e.right++;
  };
  for (const s of S().sessions) add(s.dateKST, s.uid, s.chapter, 'study');
  for (const q of Object.values(S().questions || {})) if (q.createdAt > 0) add(kstDateStr(q.createdAt), q.author, q.chapter, 'make');
  for (const a of Object.values(S().answers || {})) if (a.at > 0) add(kstDateStr(a.at), a.uid, a.chapter, 'solve', a.correct);
  // 진도 체크: 체크한 날짜에 표시. 날짜 저장 전에 체크한 건 그 챕터 기간 마지막 날에 '날짜 기록 전'으로.
  for (const [uid, p] of Object.entries(S().progress || {})) {
    for (const ch of chapters()) {
      const at = p.checkedAt?.[ch.no] || {};
      const today = todayKST();
      const legacyDay = ch.end < today ? ch.end : today;
      (p.concept?.[ch.no] || []).filter((i) => i < ch.topics.length).forEach((i) => {
        const ms = at[`c${i}`];
        add(ms ? kstDateStr(ms) : legacyDay, uid, ch.no, ms ? 'concept' : 'concept-old');
      });
      ['solved', 'wrong'].forEach((k) => {
        if (!p.workbook?.[ch.no]?.[k]) return;
        const ms = at[`w_${k}`];
        add(ms ? kstDateStr(ms) : legacyDay, uid, ch.no, ms ? 'workbook' : 'workbook-old');
      });
    }
  }
  return out;
}

function renderCalendar(me, fr, today) {
  if (!ui.calMonth) ui.calMonth = today.slice(0, 7);
  if (!ui.calSel) ui.calSel = today;
  const [y, m] = ui.calMonth.split('-').map(Number);
  const first = `${ui.calMonth}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = `${ui.calMonth}-${String(lastDay).padStart(2, '0')}`;
  const gridStart = mondayOf(first);
  const gridEnd = addDays(mondayOf(last), 6);
  const examDate = S().room.examDate;
  const act = activityByDate(me, fr, gridStart, gridEnd);

  // 같은 챕터는 하나로 묶고, 누가 했는지는 색깔 점으로
  const entries = (date) => {
    const map = new Map();
    for (const e of Object.values(act[date] || {})) {
      const g = map.get(e.chapter) || { chapter: e.chapter, me: false, fr: false, n: 0 };
      if (e.uid === me) g.me = true; else g.fr = true;
      g.n += e.n;
      map.set(e.chapter, g);
    }
    return [...map.values()].sort((a, b) => b.n - a.n);
  };

  let cells = '';
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) {
    const inMonth = d.slice(0, 7) === ui.calMonth;
    const es = entries(d);
    const cls = ['cal-cell', inMonth ? '' : 'out', d === today ? 'today' : '', d === ui.calSel ? 'sel' : '', d === examDate ? 'exam' : '', weekdayIdx(d) >= 5 ? 'wkend' : ''].join(' ');
    cells += `<button class="${cls}" data-action="cal-day" data-date="${d}">
      <span class="cal-num">${Number(d.slice(8))}</span>
      ${d === examDate ? '<span class="cal-exam">시험</span>' : ''}
      ${es.slice(0, 2).map((e) => `<span class="cal-tag"><span class="cal-chno">Ch${e.chapter}<span class="cal-who">${e.me ? '<b class="me"></b>' : ''}${e.fr ? '<b class="fr"></b>' : ''}</span></span><span class="cal-title">${esc(chapterByNo(e.chapter)?.title || '')}</span></span>`).join('')}
      ${es.length > 2 ? `<span class="cal-more">+${es.length - 2}</span>` : ''}
    </button>`;
  }

  // 선택한 날 상세 (시간 없이 한 일만)
  const sel = ui.calSel;
  const selAct = activityByDate(me, fr, sel, sel)[sel] || {};
  const order = { concept: 0, 'concept-old': 1, workbook: 2, 'workbook-old': 3, make: 4, solve: 5, study: 6 };
  const list = Object.values(selAct).sort((a, b) => (a.uid === me ? 0 : 1) - (b.uid === me ? 0 : 1) || a.chapter - b.chapter || order[a.kind] - order[b.kind]);
  const what = (e) => ({
    make: `문제 ${e.n}개 만듦`,
    solve: `문제 ${e.n}개 풂 · 정답 ${e.right}`,
    concept: `개념서 ${e.n}단원 체크`,
    'concept-old': `개념서 ${e.n}단원 완료<small>날짜 기록 전</small>`,
    workbook: `문제집 ${e.n === 2 ? '풀이·오답' : ''} 체크`.replace('  ', ' '),
    'workbook-old': `문제집 체크<small>날짜 기록 전</small>`,
  }[e.kind] || '공부 기록');
  const detail = list.length
    ? list.map((e) => `<div class="recent-item"><span class="dot ${e.uid === me ? 'me' : 'fr'}"></span><div class="grow"><b>Ch${e.chapter} ${esc(chapterByNo(e.chapter)?.title || '')}</b><div class="mini muted">${esc(e.uid === me ? myName() : friendName())}</div></div><b class="act-what">${what(e)}</b></div>`).join('')
    : '<div class="empty-note" style="padding:14px 0">이날은 기록이 없어요.</div>';

  return `
  ${head('THE NUMBERS', '학습 기록')}
  ${statsTabs()}
  <div class="recordcard cal-card" style="margin-top:18px">
    <div class="row cal-nav">
      <button class="cal-arrow" data-action="cal-move" data-d="-1" aria-label="이전 달">‹</button>
      <span class="strong" style="font-size:16px">${y}년 ${m}월</span>
      <button class="cal-arrow" data-action="cal-move" data-d="1" aria-label="다음 달">›</button>
    </div>
    <div class="cal-grid cal-head">${['월', '화', '수', '목', '금', '토', '일'].map((w) => `<span>${w}</span>`).join('')}</div>
    <div class="cal-grid">${cells}</div>
    <div class="chartlegend" style="margin-top:10px"><span class="c-me">● ${esc(myName())}</span><span style="color:var(--fr-bar)">● ${esc(friendName())}</span></div>
  </div>
  <div class="row" style="margin-top:20px"><span class="section-label">${dateLabel(sel)}</span></div>
  <div class="recent">${detail}</div>
  <div class="hint-row">진도 체크·문제 만들기·풀기를 한 날에 자동으로 표시돼요<br>11/15 전에 체크한 진도는 날짜가 없어서 그 챕터 마지막 날에 모아서 보여요</div>`;
}

function renderStats() {
  const me = meId();
  const fr = friendId();
  const today = todayKST();
  if (ui.statsRange !== 'cal') ui.statsRange = 'chapters';
  if (ui.statsRange === 'cal') return renderCalendar(me, fr, today);

  const cur = currentChapterNo();
  const tot = (uid, other) => chapters().reduce((t, c) => {
    const st = quizStats(uid, other, c.no);
    t.made += st.made; t.solved += st.solved; t.right += st.right;
    t.concept += conceptDone(uid, c.no);
    return t;
  }, { made: 0, solved: 0, right: 0, concept: 0 });
  const mt = tot(me, fr), ft = tot(fr, me);
  const topics = chapters().reduce((t, c) => t + c.topics.length, 0);
  const pct = (t) => (t.solved ? `${Math.round((t.right / t.solved) * 100)}<span>%</span>` : '–');
  const box = (t, name, cls) => `<div><span class="mini ${cls}">● ${esc(name)}</span><strong>${pct(t)}</strong>
    <div class="stat-lines"><span>정답 ${t.right}/${t.solved}</span><span>만든 문제 ${t.made}</span><span>개념서 ${t.concept}/${topics}</span></div></div>`;

  const rows = chapters().map((c) => {
    const ms = quizStats(me, fr, c.no), fs = quizStats(fr, me, c.no);
    const n = c.topics.length;
    return `<div class="ch-row ${c.no === cur ? 'now' : ''}">
      <div class="ch-name"><b>Ch${c.no} ${esc(c.title)}</b><small>${shortDate(c.start)}–${shortDate(c.end)}</small></div>
      <div class="ch-val"><span class="c-me">${n ? `${conceptDone(me, c.no)}/${n}` : '–'}</span><span class="c-fr">${n ? `${conceptDone(fr, c.no)}/${n}` : '–'}</span></div>
      <div class="ch-val"><span class="c-me">${ms.right}/${ms.otherMade}</span><span class="c-fr">${fs.right}/${fs.otherMade}</span></div>
    </div>`;
  }).join('');

  return `
  ${head('THE NUMBERS', '학습 기록')}
  ${statsTabs()}
  <div class="recordcard" style="margin-top:18px">
    <div class="row"><span class="strong" style="font-size:15px">전체 정답률</span><span class="mini muted">상대 문제 기준</span></div>
    <div class="statpair">${box(mt, myName(), 'c-me')}${box(ft, friendName(), 'c-fr')}</div>
  </div>
  <div class="recordcard ch-table" style="margin-top:14px">
    <div class="ch-row ch-head"><span>챕터</span><span>개념서</span><span>정답</span></div>
    ${rows}
    <div class="chartlegend" style="margin-top:12px"><span class="c-me">● ${esc(myName())}</span><span style="color:var(--fr-bar)">● ${esc(friendName())}</span></div>
  </div>`;
}

// ───────────────── 설정 시트 ─────────────────
function openSettings() {
  const r = S().room;
  const myName = S().members[meId()]?.name || '';
  const wrap = document.createElement('div');
  wrap.className = 'sheet-back';
  wrap.innerHTML = `<div class="sheet" role="dialog" aria-label="설정">
    <div class="sheet-head" id="sheet-drag"><div class="grab"></div><h2>설정</h2></div>
    <div class="sheet-body">
    <label>스킨 색상 <span class="muted" style="font-weight:600">(이 기기에만 적용)</span></label>
    <div class="skin-pick" role="radiogroup" aria-label="스킨">${SKINS.map((s) => `<button role="radio" aria-checked="${getSkin() === s.id}" class="${getSkin() === s.id ? 'on' : ''}" data-skin="${s.id}"><span class="sdot" style="background:${s.color}">${getSkin() === s.id ? '✓' : ''}</span><span class="nm">${s.name}</span></button>`).join('')}</div>
    <label>내 이름 <span class="muted" style="font-weight:600">(상대 화면에도 표시)</span></label>
    <input class="field" id="set-name" maxlength="10" placeholder="예: 불리" value="${esc(myName)}">
    <div class="two">
      <div><label>시험일</label><input class="field" type="date" id="set-exam" value="${esc(r.examDate)}"></div>
      <div><label>커리큘럼 시작일</label><input class="field" type="date" id="set-start" value="${esc(r.curriculumStart)}"></div>
    </div>
    <div class="hint">시작일을 바꾸면 모든 챕터가 그날부터 1주씩 다시 배치돼요. 챕터별 날짜는 <b>진도 탭</b>에서 하나씩 고칠 수 있어요. 마지막 챕터가 끝나면 시험 전날까지 '최종 복습 기간'.</div>
    <label>챕터 · 개념서 단원</label>
    <textarea class="field" id="set-chapters" spellcheck="false">${esc(chaptersToText(chapters()))}</textarea>
    <div class="hint">형식: <b>번호 | 챕터명 | 페이지</b>, 아래 줄에 <b>- 단원명</b>. 개념서 목차의 대단원 번호 순서대로 적어주세요.<br>⚠ 이미 체크한 단원은 '순서'로 기억돼요. 중간에 단원을 끼워 넣으면 체크가 밀릴 수 있어요.</div>
    <label>백업</label>
    <div class="backup-box">
      <div class="two"><button class="btn-line" id="set-backup">⬇ 백업 파일 받기</button><button class="btn-line" id="set-restore">⬆ 백업에서 복원</button></div>
      <input type="file" id="set-restore-file" accept=".json,application/json" hidden>
      <div class="hint">문제·풀이 결과·진도·챕터 날짜를 파일 하나로 저장해요. 폰에서는 "파일에 저장"이나 드라이브·카톡 나에게 보내기로 보관하면 돼요.<br><span id="set-lastbackup">${lastBackupText()}</span></div>
    </div>
    <button class="text-btn" id="set-logout">${isDemo ? '데모 데이터 초기화' : '로그아웃'}</button>
    <div class="foot">${isDemo ? '데모 모드 · 이 기기에만 저장돼요' : esc(S().user?.email || '')} · v${VERSION}<br>시험일·시작일·챕터는 두 사람이 같이 써요.</div>
    </div>
    <div class="sheet-foot">
      <button class="btn-line" id="set-close">닫기</button>
      <button class="btn-block" id="set-save">저장</button>
    </div>
  </div>`;
  document.body.appendChild(wrap);
  const sheet = wrap.querySelector('.sheet');
  const unlock = lockBackground(wrap);

  // 챕터 입력칸: 누르고 위아래로 쓸면 내용이 스크롤 (편집 중이 아닐 때는 직접 스크롤 처리)
  // 손을 떼도 아이폰처럼 관성으로 미끄러지며 서서히 멈춤
  const ta = wrap.querySelector('#set-chapters');
  let ty = null, lastT = 0, vel = 0, rafId = 0, target = 0;
  const stopGlide = () => { cancelAnimationFrame(rafId); rafId = 0; };
  ta.addEventListener('touchstart', (e) => {
    stopGlide();
    if (document.activeElement === ta) { ty = null; return; }
    ty = e.touches[0].clientY; lastT = performance.now(); vel = 0; target = ta.scrollTop;
  }, { passive: true });
  ta.addEventListener('touchmove', (e) => {
    if (ty == null) return; // 편집 중이면 아이폰 기본 동작
    const y = e.touches[0].clientY, now = performance.now();
    const dy = ty - y, dt = Math.max(1, now - lastT);
    vel = 0.75 * (dy / dt) + 0.25 * vel; // px/ms, 최근 움직임 위주로 부드럽게
    target = Math.max(0, Math.min(ta.scrollHeight - ta.clientHeight, target + dy));
    ta.scrollTop = target;
    ty = y; lastT = now;
    e.preventDefault();
    e.stopPropagation();
  }, { passive: false });
  ta.addEventListener('touchend', () => {
    if (ty == null) return;
    ty = null;
    if (performance.now() - lastT > 80 || Math.abs(vel) < 0.05) return; // 멈췄다 뗀 경우
    let prev = performance.now();
    const glide = (now) => {
      const dt = Math.min(32, now - prev); prev = now;
      vel *= Math.pow(0.996, dt); // 감속 (값이 1에 가까울수록 오래 미끄러짐)
      const max = ta.scrollHeight - ta.clientHeight;
      target = Math.max(0, Math.min(max, target + vel * dt));
      ta.scrollTop = target;
      if (Math.abs(vel) < 0.02 || target <= 0 || target >= max) { rafId = 0; return; }
      rafId = requestAnimationFrame(glide);
    };
    rafId = requestAnimationFrame(glide);
  });
  requestAnimationFrame(() => wrap.classList.add('open'));

  const close = () => {
    wrap.classList.remove('open');
    sheet.style.transform = '';
    setTimeout(() => { wrap.remove(); unlock(); }, 220);
  };
  const snapBack = () => {
    sheet.style.transition = '';
    sheet.style.transform = '';
  };
  const askClose = () => {
    if (wrap.querySelector('.confirm-back')) return;
    const c = document.createElement('div');
    c.className = 'confirm-back';
    c.innerHTML = `<div class="confirm-box" role="alertdialog" aria-label="닫기 확인">
      <b>설정을 닫을까요?</b><p>저장하지 않은 내용은 사라져요.</p>
      <div class="confirm-row"><button class="btn-line" data-c="no">아니오</button><button class="btn-block" data-c="yes">예</button></div></div>`;
    wrap.appendChild(c);
    c.addEventListener('click', (e) => {
      const b = e.target.closest('[data-c]');
      if (!b && e.target !== c) return;
      c.remove();
      if (b?.dataset.c === 'yes') close();
    });
  };

  // 위쪽 손잡이를 아래로 끌면 → 닫을지 물어봄
  const handle = wrap.querySelector('#sheet-drag');
  let startY = null, dy = 0;
  handle.addEventListener('pointerdown', (e) => {
    startY = e.clientY; dy = 0;
    sheet.style.transition = 'none';
    handle.setPointerCapture?.(e.pointerId);
  });
  handle.addEventListener('pointermove', (e) => {
    if (startY == null) return;
    dy = Math.max(0, e.clientY - startY);
    sheet.style.transform = `translateY(${dy}px)`;
  });
  const endDrag = () => {
    if (startY == null) return;
    startY = null;
    snapBack();
    if (dy > 70) askClose();
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);

  wrap.addEventListener('click', (e) => { if (e.target === wrap) askClose(); });
  wrap.querySelector('#set-close').onclick = close;
  wrap.querySelectorAll('[data-skin]').forEach((b) => b.addEventListener('click', () => {
    setSkin(b.dataset.skin);
    wrap.querySelectorAll('[data-skin]').forEach((x) => {
      const on = x.dataset.skin === b.dataset.skin;
      x.classList.toggle('on', on);
      x.setAttribute('aria-checked', on);
      x.querySelector('.sdot').textContent = on ? '✓' : '';
    });
  }));
  wrap.querySelector('#set-logout').onclick = async () => { close(); await store.logout(); };
  wrap.querySelector('#set-backup').onclick = async () => {
    try { await downloadBackup(); wrap.querySelector('#set-lastbackup').textContent = lastBackupText(); } catch (err) { handleError(err); }
  };
  const $file = wrap.querySelector('#set-restore-file');
  wrap.querySelector('#set-restore').onclick = () => $file.click();
  $file.onchange = async () => { const f = $file.files?.[0]; $file.value = ''; if (f) await restoreFromFile(f); };
  wrap.querySelector('#set-save').onclick = async () => {
    const name = wrap.querySelector('#set-name').value.trim();
    const examDate = wrap.querySelector('#set-exam').value;
    const curriculumStart = wrap.querySelector('#set-start').value;
    const parsed = textToChapters(wrap.querySelector('#set-chapters').value);
    const restart = curriculumStart !== r.curriculumStart;
    const chs = fillChapterDates(parsed.map((c) => {
      const old = chapters().find((o) => o.no === c.no);
      return restart || !old ? c : { ...c, start: old.start, end: old.end };
    }), curriculumStart);
    if (!examDate || !curriculumStart) return toast('날짜를 입력해 주세요');
    if (!chs.length) return toast('챕터를 최소 1개 입력해 주세요');
    if (new Set(chs.map((c) => c.no)).size !== chs.length) return toast('챕터 번호가 겹쳐요');
    try {
      if (name !== myName) await store.updateMyName(name);
      await store.updateRoom({ examDate, curriculumStart, chapters: chs, schema: SCHEMA });
      toast('저장했어요');
      close();
    } catch (e) { handleError(e); }
  };
}

// ───────────────── 기록 수정/삭제 ─────────────────
function kstMs(date, hhmm) {
  return Date.parse(`${date}T${hhmm}:00+09:00`);
}
function openSessionEditor(id) {
  const s = S().sessions.find((x) => x.id === id && x.uid === meId());
  if (!s) return;
  const ch = chapterByNo(s.chapter);
  let type = s.type;
  const wrap = document.createElement('div');
  wrap.className = 'confirm-back';
  const unlock = lockBackground(wrap);
  const close = () => { wrap.remove(); unlock(); };

  const formHTML = () => `<div class="confirm-box edit-box" role="dialog" aria-label="기록 수정">
    <b>기록 수정</b>
    <p>${dateLabel(s.dateKST)} · ${esc(ch?.title || '')}</p>
    <div class="types small">${TYPES.map((t) => `<button class="${t === type ? 'selected' : ''}" data-type="${t}">${t}</button>`).join('')}</div>
    <div class="two">
      <div><label>시작</label><input class="field" type="time" id="e-start" value="${kstHHMM(s.startAt)}"></div>
      <div><label>종료</label><input class="field" type="time" id="e-end" value="${kstHHMM(s.endAt)}"></div>
    </div>
    <label>공부한 시간</label>
    <div class="min-row"><input class="field" type="number" inputmode="numeric" min="1" max="1440" id="e-min" value="${Math.round(s.durationSec / 60)}"><span>분</span></div>
    <div class="hint">시작·종료를 바꾸면 자동 계산돼요. 중간에 쉰 시간은 빼고 직접 고쳐도 돼요.</div>
    <div class="confirm-row" style="margin-top:16px"><button class="btn-line" data-e="cancel">취소</button><button class="btn-block" data-e="save">저장</button></div>
    <button class="text-btn" data-e="delete">이 기록 삭제</button>
  </div>`;
  const askDeleteHTML = `<div class="confirm-box" role="alertdialog">
    <b>이 기록을 삭제할까요?</b><p>친구 화면에서도 사라지고 되돌릴 수 없어요.</p>
    <div class="confirm-row"><button class="btn-line" data-e="back">아니오</button><button class="btn-block danger" data-e="really-delete">삭제</button></div></div>`;

  const span = () => {
    const st = wrap.querySelector('#e-start').value, en = wrap.querySelector('#e-end').value;
    if (!st || !en) return null;
    const a = kstMs(s.dateKST, st);
    let b = kstMs(s.dateKST, en);
    if (b <= a) b += 864e5; // 자정 넘긴 경우
    return { a, b };
  };
  const bindForm = () => {
    wrap.innerHTML = formHTML();
    const sync = () => { const sp = span(); if (sp) wrap.querySelector('#e-min').value = Math.round((sp.b - sp.a) / 60000); };
    wrap.querySelector('#e-start').addEventListener('change', sync);
    wrap.querySelector('#e-end').addEventListener('change', sync);
  };
  bindForm();
  document.body.appendChild(wrap);

  wrap.addEventListener('click', async (e) => {
    if (e.target === wrap) return close();
    const t = e.target.closest('[data-type]');
    if (t) {
      type = t.dataset.type;
      wrap.querySelectorAll('.types button').forEach((b) => b.classList.toggle('selected', b.dataset.type === type));
      return;
    }
    const act = e.target.closest('[data-e]')?.dataset.e;
    if (!act) return;
    try {
      if (act === 'cancel') close();
      else if (act === 'delete') wrap.innerHTML = askDeleteHTML;
      else if (act === 'back') bindForm();
      else if (act === 'really-delete') {
        await store.deleteSession(s.id);
        close();
        toast('기록을 삭제했어요');
      } else if (act === 'save') {
        const sp = span();
        if (!sp) return toast('시작·종료 시간을 입력해 주세요');
        const min = parseInt(wrap.querySelector('#e-min').value, 10);
        if (Number.isNaN(min) || min < 1 || min > 1440) return toast('공부한 시간은 1~1440분으로 입력해 주세요');
        if (min * 60000 > sp.b - sp.a + 60000) return toast('공부한 시간이 시작~종료보다 길어요');
        await store.updateSession(s.id, { type, startAt: sp.a, endAt: sp.b, durationSec: min * 60 });
        close();
        toast('수정했어요');
      }
    } catch (err) { handleError(err); }
  });
}


// ───────────────── 백업 ─────────────────
// 파일 하나(JSON)에 둘의 데이터를 전부 담음. 복원할 땐 "내 것"만 되돌림 (상대 것은 상대 폰에서 복원).
const BACKUP_APP = 'study-duo';
const strip = (o) => JSON.parse(JSON.stringify(o ?? null));
function buildBackup() {
  const st = S();
  const r = st.room || {};
  return {
    app: BACKUP_APP,
    version: 1,
    exportedAt: new Date().toISOString(),
    exportedBy: { uid: meId(), email: st.user?.email || '', name: myName() },
    room: { examDate: r.examDate, curriculumStart: r.curriculumStart, chapters: chapters(), schema: r.schema || SCHEMA },
    members: strip(st.members),
    progress: strip(st.progress),
    questions: strip(st.questions || {}),
    answers: strip(st.answers || {}),
    sessions: strip(st.sessions || []),
  };
}
function backupFileName() {
  const d = new Date(nowMs() + 9 * 3600e3).toISOString();
  return `study-duo-backup-${d.slice(0, 10)}-${d.slice(11, 16).replace(':', '')}.json`;
}
async function downloadBackup() {
  const data = buildBackup();
  const name = backupFileName();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  // 폰: 공유 시트로 "파일에 저장"/드라이브/카톡 등 / PC: 다운로드 폴더
  if (navigator.canShare && navigator.canShare({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
    try {
      await navigator.share({ files: [file], title: '우리의 공부 백업' });
      markBackup();
      return;
    } catch (e) {
      if (e?.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  markBackup();
}
function markBackup() {
  try { localStorage.setItem('studyduo-last-backup', String(Date.now())); } catch (e) {}
  toast('백업 파일을 만들었어요');
}
function lastBackupText() {
  let t = 0;
  try { t = Number(localStorage.getItem('studyduo-last-backup') || 0); } catch (e) {}
  if (!t) return '아직 이 기기에서 백업한 적 없어요';
  const d = new Date(t + 9 * 3600e3).toISOString();
  return `마지막 백업: ${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))} ${d.slice(11, 16)}`;
}

// 백업 파일 → 내 현재 계정 기준으로 바꿔서 복원 (계정을 새로 만들었어도 이메일로 찾아서 맞춤)
async function restoreFromFile(file) {
  let b;
  try { b = JSON.parse(await file.text()); } catch (e) { return toast('백업 파일을 읽을 수 없어요'); }
  if (!b || b.app !== BACKUP_APP) return toast('우리의 공부 백업 파일이 아니에요');
  const me = meId();
  const fr = friendId();
  const myEmail = (S().user?.email || '').toLowerCase();
  const members = b.members || {};
  const byEmail = (email) => Object.keys(members).find((k) => (members[k]?.email || '').toLowerCase() === email);
  const oldMe = (myEmail && byEmail(myEmail)) || (isDemo ? b.exportedBy?.uid : null);
  if (!oldMe) return toast('이 백업에서 내 계정 데이터를 찾지 못했어요');
  const oldFr = Object.keys(members).find((k) => k !== oldMe) || null;
  const frEmail = fr ? (S().members[fr]?.email || '').toLowerCase() : '';
  const oldFrMatch = oldFr && (!frEmail || (members[oldFr]?.email || '').toLowerCase() === frEmail) ? oldFr : null;
  const mapUid = (u) => (u === oldMe ? me : u === oldFrMatch && fr ? fr : u);

  const questions = Object.values(b.questions || {}).filter((q) => q.author === oldMe)
    .map((q) => ({ ...q, author: me, id: `${me}_${q.chapter}_${q.slot}` }));
  const answers = Object.values(b.answers || {}).filter((a) => a.uid === oldMe).map((a) => {
    const author = mapUid(a.author);
    const qid = `${author}_${a.chapter}_${a.slot}`;
    return { ...a, uid: me, author, qid, id: `${me}_${qid}` };
  });
  const sessions = (b.sessions || []).filter((s) => s.uid === oldMe)
    .map((s) => ({ ...s, uid: me, id: `${me}_${s.startAt}` }));
  const progress = b.progress?.[oldMe] || null;
  const name = members[oldMe]?.name ?? null;
  const room = b.room ? { examDate: b.room.examDate, curriculumStart: b.room.curriculumStart, chapters: b.room.chapters, schema: b.room.schema || SCHEMA } : null;
  const t = Date.parse(b.exportedAt || '');
  const when = t ? new Date(t + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') : '';

  const ok = await confirmBox('이 백업으로 되돌릴까요?',
    `${esc(when)} 백업 · 내 문제 ${questions.length}개, 내 풀이 ${answers.length}개, 진도, 시험일·챕터 설정을 지금 데이터 위에 덮어써요.<br>${esc(friendName())} 데이터는 ${esc(friendName())} 폰에서 같은 파일로 복원하면 돼요.`,
    '복원');
  if (!ok) return;
  try {
    await store.restoreMine({ room, name, progress, questions, answers, sessions });
    toast('백업에서 복원했어요');
  } catch (err) { handleError(err); }
}

// 시트가 열려 있는 동안 뒤 화면이 같이 움직이지 않게 고정 (아이폰 스크롤 전달 방지)
function lockBackground(layer) {
  const y = window.scrollY;
  const b = document.body.style;
  const prev = { position: b.position, top: b.top, left: b.left, right: b.right, overflow: b.overflow };
  Object.assign(b, { position: 'fixed', top: `-${y}px`, left: '0', right: '0', overflow: 'hidden' });
  const canScroll = (el) => el && el.scrollHeight > el.clientHeight + 1;
  const onMove = (e) => {
    // 실제로 스크롤할 내용이 있는 칸(챕터 입력칸, 설정 내용) 안에서만 스크롤 허용
    const ta = e.target.closest('textarea');
    const body = e.target.closest('.sheet-body');
    if ((ta && document.activeElement === ta && canScroll(ta)) || canScroll(body)) return;
    e.preventDefault();
  };
  layer.addEventListener('touchmove', onMove, { passive: false });
  return () => {
    layer.removeEventListener('touchmove', onMove);
    Object.assign(b, prev);
    window.scrollTo(0, y);
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
  maybeMigrate();
  lastShell = 'app';

  const chipsScroll = document.getElementById('chips')?.scrollLeft;
  const y = window.scrollY;
  let body;
  if (ui.tab === 'timer') body = renderTimer();
  else if (ui.tab === 'quiz') body = renderQuiz();
  else if (ui.tab === 'progress') body = renderProgress();
  else if (ui.tab === 'stats') body = renderStats();
  else body = renderHome();

  const quizBadge = unsolvedCount() > 0 && ui.tab !== 'quiz';
  $app.dataset.tab = ui.tab;
  $app.innerHTML = `${isDemo ? `<div class="demo-bar">데모 모드 · 이 기기에만 저장돼요 · Firebase 연결 전${params.get('sample') === '1' ? ' · 시연 데이터' : ''}</div>` : ''}
  <div class="screen">${body}</div>
  <nav class="nav">${[['home', '홈'], ['progress', '진도'], ['quiz', '문제'], ['stats', '기록']].map(([k, l]) => `<button class="${ui.tab === k ? 'active' : ''}" data-action="go" data-tab="${k}"><span class="${k === 'quiz' && quizBadge ? 'badge' : ''}">${ICONS[k]}</span><span>${l}</span></button>`).join('')}</nav>`;

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
      case 'go-quiz':
        ui.tab = 'quiz'; ui.quizTab = el.dataset.qtab || 'solve'; ui.quizSolve = null; ui.quizJust = null;
        ui.quizCh = currentChapterNo() ?? ui.quizCh;
        history.replaceState(null, '', '#quiz'); window.scrollTo(0, 0); render();
        break;
      case 'q-ch':
        ui.quizCh = Number(el.dataset.ch); render();
        break;
      case 'q-tab':
        ui.quizTab = el.dataset.qtab; render();
        break;
      case 'q-wrongall':
        ui.wrongAll = !ui.wrongAll; render();
        break;
      case 'q-continue': {
        const nx = partnerQs(ui.quizCh).find((x) => !ansOf(meId(), x));
        if (nx) { ui.quizSolve = nx.id; ui.quizRetry = false; ui.quizJust = null; window.scrollTo(0, 0); render(); }
        break;
      }
      case 'q-open':
        ui.quizSolve = el.dataset.id; ui.quizRetry = !!el.dataset.retry; ui.quizJust = null;
        window.scrollTo(0, 0); render();
        break;
      case 'q-back':
        ui.quizSolve = null; ui.quizJust = null; ui.quizRetry = false; render();
        break;
      case 'q-retry':
        ui.quizRetry = true; ui.quizJust = null; render();
        break;
      case 'q-pick': {
        const q = S().questions?.[ui.quizSolve];
        if (!q) break;
        const choice = Number(el.dataset.i);
        ui.quizJust = { qid: q.id, choice };
        ui.quizRetry = false;
        render();
        await store.answerQuestion(q, choice);
        break;
      }
      case 'q-edit':
        openQuestionEditor(ui.quizCh, Number(el.dataset.slot));
        break;
      case 'p-dates':
        openChapterDates(ui.progCh);
        break;
      case 'p-who':
        ui.pracWho = el.dataset.who; render();
        break;
      case 'p-prac': {
        const k = el.dataset.key;
        const i = Number(el.dataset.i);
        const list = [...(practiceOf(meId(), ui.progCh)[k])];
        const at = list.indexOf(i);
        if (at >= 0) list.splice(at, 1); else list.push(i);
        list.sort((a, b) => a - b);
        await store.setPractice(ui.progCh, k, list);
        break;
      }
      case 'p-book':
        ui.progBook = el.dataset.book; render();
        break;
      case 'p-concept': {
        const i = Number(el.dataset.i);
        const list = [...(S().progress[meId()]?.concept?.[ui.progCh] || [])];
        const at = list.indexOf(i);
        if (at >= 0) list.splice(at, 1); else list.push(i);
        list.sort((a, b) => a - b);
        await store.setConcept(ui.progCh, list, at >= 0 ? null : i);
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
      case 'cal-day':
        ui.calSel = el.dataset.date;
        if (ui.calSel.slice(0, 7) !== ui.calMonth) ui.calMonth = ui.calSel.slice(0, 7);
        render();
        break;
      case 'cal-move': {
        const [yy, mm] = ui.calMonth.split('-').map(Number);
        const t = new Date(Date.UTC(yy, mm - 1 + Number(el.dataset.d), 1));
        ui.calMonth = t.toISOString().slice(0, 7);
        render();
        break;
      }
      case 's-all':
        ui.showAllRecent = !ui.showAllRecent; render();
        break;
      case 'edit-session':
        openSessionEditor(el.dataset.id);
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
  if (c.includes('permission-denied') && err.where === 'quiz') return '문제은행을 쓰려면 Firestore 규칙을 새로 게시해 주세요';
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
  if (['home', 'quiz', 'timer', 'progress', 'stats'].includes(t) && t !== ui.tab) { ui.tab = t; window.scrollTo(0, 0); render(); }
});

// 새 버전이 올라오면 자동으로 새로고침 (GitHub Pages 캐시 때문에 늦게 반영되는 것 방지)
async function checkUpdate() {
  try {
    const r = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
    const v = (await r.json()).version;
    if (!v || v === VERSION) return;
    if (document.querySelector('.sheet-back')) return; // 설정 편집 중엔 건드리지 않음
    const key = `studyduo-reloaded-${v}`;
    if (sessionStorage.getItem(key)) return; // 무한 새로고침 방지
    sessionStorage.setItem(key, '1');
    location.reload();
  } catch (e) {}
}
checkUpdate();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkUpdate(); });

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
