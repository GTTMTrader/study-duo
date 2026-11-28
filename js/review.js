// 복습 탐사대 — 화면
import * as C from './review-core.js';
import { createReviewStore } from './review-store.js';
import { todayKST, setTodayOverride } from './dates.js';

const DECK_ID = 'nsca';
const DECK_URL = 'data/nsca-sports-nutrition.json?v=1';
const $app = document.getElementById('app');

{ // 데모에서 날짜 바꿔보기: ?demo&today=2026-12-03
  const q = new URLSearchParams(location.search);
  if (q.has('demo') && q.get('today')) setTodayOverride(q.get('today'));
}

const ui = {
  tab: location.hash === '#units' ? 'units' : 'today',
  screen: 'home',          // home | quiz | done | login
  session: null,
  toast: '',
  animate: true,
};
let store, deck, idx;
let state = C.emptyState();
let loaded = false;
let day = todayKST();
let busy = false;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const unitById = (id) => deck.units.find((u) => u.id === id);
const unitName = (id) => `${id}장 ${unitById(id)?.title || ''}`;
const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── 마스코트 ─────────────────────────────────────────────
function robot(size = 96, cls = '') {
  return `<svg class="robot ${cls}" width="${size}" height="${size}" viewBox="0 0 120 120" aria-hidden="true">
    <ellipse cx="60" cy="104" rx="34" ry="6" fill="#8f8ff5" opacity=".55"/>
    <line x1="60" y1="22" x2="60" y2="34" stroke="#1f2042" stroke-width="3" stroke-linecap="round"/>
    <circle cx="60" cy="18" r="6" fill="#eef56b" stroke="#1f2042" stroke-width="2.5"/>
    <rect x="22" y="48" width="12" height="26" rx="6" fill="#eef56b" stroke="#1f2042" stroke-width="2.5"/>
    <rect x="86" y="48" width="12" height="26" rx="6" fill="#eef56b" stroke="#1f2042" stroke-width="2.5"/>
    <rect x="30" y="32" width="60" height="58" rx="22" fill="#fff" stroke="#1f2042" stroke-width="3"/>
    <rect x="39" y="44" width="42" height="30" rx="12" fill="#1f2042"/>
    <rect class="eye" x="49" y="52" width="5" height="10" rx="2.5" fill="#eef56b"/>
    <rect class="eye" x="66" y="52" width="5" height="10" rx="2.5" fill="#eef56b"/>
    <rect x="57" y="66" width="7" height="2.5" rx="1.2" fill="#eef56b"/>
    <circle cx="48" cy="94" r="6" fill="#fff" stroke="#1f2042" stroke-width="2.5"/>
    <circle cx="72" cy="94" r="6" fill="#fff" stroke="#1f2042" stroke-width="2.5"/>
  </svg>`;
}
const spark = (cls = '') => `<svg class="spark ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.5c.6 5.6 4.9 9.9 10.5 10.5-5.6.6-9.9 4.9-10.5 10.5C11.4 16.9 7.1 12.6 1.5 12 7.1 11.4 11.4 7.1 12 1.5z"/></svg>`;
const planet = (on) => `<svg class="planet ${on ? 'on' : ''}" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="8"/><ellipse cx="16" cy="16" rx="14" ry="4.2" transform="rotate(-18 16 16)"/></svg>`;

// ── 공통 ────────────────────────────────────────────────
function toast(msg) {
  ui.toast = msg;
  const el = document.querySelector('.toast');
  if (el) { el.textContent = msg; el.classList.add('show'); }
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { ui.toast = ''; document.querySelector('.toast')?.classList.remove('show'); }, 2600);
}

function fmtDate(s) {
  const d = new Date(s + 'T00:00:00Z');
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
}

function src(card) {
  return `교재 ${card.p}쪽 · PDF ${card.pdf}페이지`;
}

async function save(fn) {
  try {
    return await store.update(fn);
  } catch (e) {
    console.error(e);
    toast(e?.code === 'permission-denied' ? '저장 권한이 없어요. 다시 로그인해 주세요.' : '저장하지 못했어요. 연결을 확인해 주세요.');
    throw e;
  }
}

// 날짜가 바뀌었으면 새 목록 계산
async function syncDay() {
  const t = todayKST();
  const dayChanged = t !== day;
  day = t;
  if (state.today.date !== t || C.topUp(state, idx, t).changed) {
    await save((latest) => {
      let r = C.ensureToday(latest, idx, t);
      const up = C.topUp(r.state, idx, t);
      return { state: up.state, changed: r.changed || up.changed };
    }).catch(() => {});
  }
  return dayChanged;
}

async function guardDay() {
  if (todayKST() === day && state.today.date === day) return false;
  const changed = await syncDay();
  if (changed) {
    ui.screen = 'home'; ui.tab = 'today'; ui.session = null;
    toast('날짜가 바뀌어 오늘의 미션을 새로 준비했어요.');
    render();
  }
  return changed;
}

// ── 오늘 탭 ─────────────────────────────────────────────
function renderToday() {
  const units = C.activeUnitIds(state);
  const p = C.todayProgress(state, day);
  const total = p.total;
  let hero;
  let main;
  if (!units.length) {
    hero = `<section class="hero">
      <div><p class="hero-k">오늘의 복습</p><p class="hero-n">출발 준비</p><span class="chip-y">단원 추가가 필요해요</span></div>
      ${robot(108, 'float')}${spark('s1')}${spark('s2')}
    </section>`;
    main = `<p class="empty">공부를 끝낸 단원을 <b>탐사 지도</b>에 추가하면<br>오늘의 문제가 배정돼요.</p>
      <button class="btn primary" data-act="tab" data-tab="units">탐사 지도 열기</button>`;
  } else if (!total) {
    hero = `<section class="hero">
      <div><p class="hero-k">오늘의 복습</p><p class="hero-n">0문제</p><span class="chip-y">오늘은 쉬어가요</span></div>
      ${robot(108, 'float')}${spark('s1')}${spark('s2')}
    </section>`;
    main = `<p class="empty">오늘 복습할 카드가 없어요.<br>더 풀고 싶으면 무한 모드로 가요.</p>`;
  } else {
    const next = state.today.ids.findIndex((id) => !state.today.done[id]);
    const dots = state.today.ids.map((id, i) => {
      const done = !!state.today.done[id];
      return `<span class="dot ${done ? 'done' : ''} ${i === next ? 'next' : ''}" style="--i:${i}">${done ? spark() : i + 1}</span>`;
    }).join('');
    const allDone = p.done === total;
    hero = `<section class="hero">
      <div><p class="hero-k">오늘의 복습</p><p class="hero-n">${total}문제</p><span class="chip-y">${allDone ? '미션 완료' : '오늘의 미션'}</span></div>
      ${robot(108, 'float')}${spark('s1')}${spark('s2')}
    </section>`;
    main = `<div class="dots" aria-label="오늘 ${total}문제 중 ${p.done}개 완료">${dots}</div>
      ${allDone
        ? `<button class="btn primary" data-act="done-screen">별 ${p.done}개를 밝혔어요 ✦</button>`
        : `<button class="btn primary" data-act="start-today">${p.done ? `이어서 풀기 · ${p.done}/${total}` : `오늘 ${total}문제 시작`}</button>`}`;
  }
  const inf = units.length
    ? `<button class="inf" data-act="infinite">
        <div><p class="inf-t">${spark()} 무한 모드</p><p class="inf-s">공부한 단원에서 원하는 만큼</p></div>
        <span class="arrow">→</span>
      </button>`
    : '';
  return `${hero}${main}${inf}`;
}

// ── 단원 탭 ─────────────────────────────────────────────
function renderUnits() {
  const left = C.remainingByUnit(state, idx, day);
  const rows = deck.units.map((u) => {
    const on = !!state.units[u.id];
    const sub = on ? (left[u.id] ? `오늘 복습 ${left[u.id]}개` : `카드 ${u.cards.length}장 · 탐사 중`) : `카드 ${u.cards.length}장`;
    return `<li class="unit ${on ? 'on' : ''}">
      <button class="unit-main" data-act="unit-info" data-unit="${u.id}" aria-label="${esc(unitName(u.id))}">
        ${planet(on)}
        <span><b>${esc(unitName(u.id))}</b><small>${sub}</small></span>
      </button>
      ${on
        ? `<button class="pill-y" data-act="unit-replay" data-unit="${u.id}">다시 풀기</button>`
        : `<button class="pill-p" data-act="unit-add" data-unit="${u.id}">추가</button>`}
    </li>`;
  }).join('');
  return `<section class="hero map">
      <div><p class="hero-n sm">탐사 지도</p><p class="hero-d">공부를 끝낸 단원을<br>여기서 추가해요.</p></div>
      ${robot(96, 'float')}${spark('s1')}
    </section>
    <ul class="units">${rows}</ul>
    <p class="foot">${esc(deck.book)} · 9개 단원 ${idx.order.length}장</p>`;
}

function renderHome() {
  const body = ui.tab === 'units' ? renderUnits() : renderToday();
  return `<div class="screen home ${ui.animate ? 'enter' : ''}">
    <header class="top">
      <p class="brand">${spark()} 복습 탐사대</p>
      <a class="back-app" href="./">우리의 공부 →</a>
    </header>
    <main class="body">${body}</main>
    ${tabsHTML()}
  </div>`;
}

function tabsHTML() {
  const t = ui.screen === 'home' ? ui.tab : 'today';
  return `<nav class="tabs" role="tablist">
      <span class="tab-pill ${t}"></span>
      <button role="tab" aria-selected="${t === 'today'}" class="${t === 'today' ? 'on' : ''}" data-act="tab" data-tab="today">오늘</button>
      <button role="tab" aria-selected="${t === 'units'}" class="${t === 'units' ? 'on' : ''}" data-act="tab" data-tab="units">단원</button>
    </nav>`;
}

// ── 문제 화면 ───────────────────────────────────────────
function startToday() {
  const p = C.todayProgress(state, day);
  if (!p.remaining.length) { ui.screen = 'done'; render(); return; }
  ui.session = { kind: 'today', queue: p.remaining.slice(), pos: 0 };
  loadCard();
}

function startInfinite(scope) {
  const units = scope ? [scope] : C.activeUnitIds(state);
  if (!units.length) { ui.tab = 'units'; ui.screen = 'home'; toast('먼저 단원을 추가해 주세요.'); render(); return; }
  ui.session = { kind: 'infinite', scope: units, queue: C.buildLap(state, idx, day, units), pos: 0, laps: 1 };
  loadCard();
}

function loadCard() {
  const s = ui.session;
  if (s.kind === 'today') {
    // 다른 기기에서 먼저 끝낸 카드는 건너뜀
    while (s.pos < s.queue.length && state.today.done[s.queue[s.pos]]) s.pos++;
    if (s.pos >= s.queue.length) {
      const p = C.todayProgress(state, day);
      if (p.remaining.length) { s.queue = p.remaining.slice(); s.pos = 0; }
      else { ui.screen = 'done'; ui.session = null; ui.animate = true; render(); return; }
    }
  } else if (s.pos >= s.queue.length) {
    s.queue = C.buildLap(state, idx, day, s.scope);
    s.pos = 0; s.laps++;
    toast('한 바퀴 완주! 새 순서로 다시 출제해요.');
  }
  const id = s.queue[s.pos];
  s.card = { id, mode: C.modeOf(state.cards[id]), hint: false, pick: null, input: '', result: null, startedDay: day };
  ui.screen = 'quiz';
  ui.animate = true;
  render();
  if (s.card.mode === 'subjective') setTimeout(() => document.querySelector('.answer-input')?.focus({ preventScroll: true }), prefersReduced ? 0 : 380);
}

function progressInfo() {
  const s = ui.session;
  if (s.kind === 'today') {
    const p = C.todayProgress(state, day);
    const n = Math.min(p.done + 1, p.total);
    return { n, total: p.total };
  }
  return { n: s.pos + 1, total: s.queue.length };
}

function renderQuiz() {
  const s = ui.session;
  const cs = s.card;
  const card = idx.byId[cs.id];
  const { n, total } = progressInfo();
  const pct = Math.round((n / total) * 100);
  const assigned = C.isAssignedToday(state, cs.id, day) && !state.today.done[cs.id];
  const r = cs.result;
  const showChoices = cs.mode === 'choice' || cs.hint;
  const letters = ['A', 'B', 'C', 'D'];

  let tags = `<span class="tag ${cs.mode === 'subjective' && !cs.hint ? 'tag-y' : ''}">${cs.mode === 'subjective' ? (cs.hint ? '주관식 · 힌트' : '주관식') : '객관식'}</span>`;
  if (s.kind === 'infinite') {
    tags = `<span class="tag ${assigned ? 'tag-p' : 'tag-g'}">${assigned ? '오늘 복습' : '자유 연습'}</span><span class="tag tag-g">${esc(unitName(idx.unitOf[cs.id]))}</span>` + tags;
  }

  let answerArea = '';
  if (showChoices) {
    answerArea = `<div class="choices" role="radiogroup">${card.c.map((t, i) => {
      if (r) {
        const isAns = i === card.a;
        const isPick = i === cs.pick;
        if (!isAns && !isPick) return `<div class="choice dim"><span class="lt">${letters[i]}</span><span>${esc(t)}</span></div>`;
        const cls = isAns ? 'ok' : 'bad';
        const label = isAns ? (isPick ? '내 선택 · 정답 · ' : '정답 · ') : '내 선택 · ';
        return `<div class="choice ${cls} reveal"><span class="lt">${letters[i]}</span><span>${label}${esc(t)}</span><i class="mark">${isAns ? '✓' : '✕'}</i></div>`;
      }
      return `<button class="choice ${cs.pick === i ? 'sel' : ''}" role="radio" aria-checked="${cs.pick === i}" data-act="pick" data-i="${i}" style="--i:${i}"><span class="lt">${letters[i]}</span><span>${esc(t)}</span></button>`;
    }).join('')}</div>`;
  }
  if (cs.mode === 'subjective' && !cs.hint) {
    if (r) {
      answerArea = `<div class="choices">
        ${r.correct
          ? `<div class="choice ok reveal"><span class="lt">✎</span><span>내 답 · 정답 · ${esc(cs.input)}</span><i class="mark">✓</i></div>`
          : `<div class="choice bad reveal"><span class="lt">✎</span><span>내 답 · ${esc(cs.input || '(빈칸)')}</span><i class="mark">✕</i></div>
             <div class="choice ok reveal"><span class="lt">✓</span><span>정답 · ${esc(card.c[card.a])}</span><i class="mark">✓</i></div>`}
      </div>`;
    } else {
      answerArea = `<p class="hint-q">한 단어로 적어보세요.</p>
        <input class="answer-input" type="text" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done" value="${esc(cs.input)}" placeholder="정답 입력" aria-label="정답 입력">
        <div class="sub-robot">${robot(72, 'float')}${spark('s3')}</div>
        <button class="link-btn" data-act="hint">막히면 보기 힌트</button>`;
    }
  }

  let feedback = '';
  let actions = '';
  if (r) {
    const good = r.correct && !cs.hint;
    feedback = `<div class="feedback ${good ? 'good' : 'again'}">
      <p class="fb-t">${good ? '기억났어요!' : r.correct ? '힌트로 맞혔어요' : '다음에 한 번 더!'}</p>
      <p class="fb-x">${esc(card.ex)}</p>
      <p class="fb-s">${src(card)}</p>
    </div>`;
    if (assigned) {
      const remDays = C.rememberDays(state.cards[cs.id]);
      const note = s.kind === 'infinite' ? '<p class="note">저장하면 오늘 복습에도 반영돼요.</p>' : '';
      actions = `${note}<div class="row-btns">
        <button class="btn ${good ? 'ghost' : 'primary'}" data-act="grade" data-g="again">다시 보기<small>내일</small></button>
        ${good ? `<button class="btn primary" data-act="grade" data-g="remember">기억남<small>${C.intervalLabel(remDays)}</small></button>` : ''}
      </div>`;
    } else {
      const due = state.cards[cs.id]?.due;
      const note = due ? `다음 복습일은 ${fmtDate(due)}이에요.` : '아직 복습 일정이 없는 카드예요.';
      actions = `<p class="note">${note}</p><button class="btn primary" data-act="next">다음 문제</button>`;
    }
  } else {
    const can = showChoices ? cs.pick !== null : true;
    actions = `<button class="btn primary" data-act="check" ${can ? '' : 'disabled'}>정답 확인</button>`;
  }

  return `<div class="screen quiz ${ui.animate ? 'enter' : ''}">
    <header class="qtop">
      <button class="icon-btn" data-act="home" aria-label="나가기"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
      <div class="bar"><span style="width:${pct}%"></span></div>
      <span class="count">${n} / ${total}</span>
    </header>
    <main class="qbody">
      <div class="tags">${tags}</div>
      <h1 class="q">${esc(card.q)}</h1>
      ${answerArea}
      ${feedback}
    </main>
    <footer class="qfoot">${actions}</footer>
  </div>`;
}

async function checkAnswer() {
  if (busy) return;
  if (await guardDay()) return;
  const s = ui.session;
  const cs = s.card;
  const card = idx.byId[cs.id];
  if (cs.mode === 'subjective' && !cs.hint) {
    cs.input = document.querySelector('.answer-input')?.value || cs.input;
    cs.result = { correct: C.checkSubjective(card, cs.input) };
  } else {
    if (cs.pick === null) return;
    cs.result = { correct: cs.pick === card.a };
  }
  ui.animate = false;
  render();
  const fb = document.querySelector('.feedback');
  fb && fb.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'nearest' });
}

async function grade(g) {
  if (busy) return;
  const s = ui.session;
  const cs = s.card;
  // 자정 전 카드의 미저장 응답은 새 미션에 반영하지 않음
  if (cs.startedDay !== todayKST()) { await guardDay(); return; }
  busy = true;
  const good = cs.result?.correct && !cs.hint;
  const finalGrade = good && g === 'remember' ? 'remember' : 'again';
  try {
    const res = await save((latest) => {
      const r = C.commitReview(latest, cs.id, finalGrade, cs.startedDay);
      return { ...r, changed: r.saved };
    });
    if (res.reason === 'already') toast('다른 곳에서 이미 저장한 카드라 다음으로 넘어가요.');
    else if (res.reason === 'date-changed') { busy = false; await guardDay(); return; }
    if (res.saved) popStar();
  } catch (e) {
    busy = false;
    return;
  }
  busy = false;
  s.pos++;
  loadCard();
}

function nextFree() {
  ui.session.pos++;
  loadCard();
}

function popStar() {
  if (prefersReduced) return;
  const el = document.createElement('div');
  el.className = 'star-pop';
  el.innerHTML = spark();
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 900);
}

// ── 완료 화면 ───────────────────────────────────────────
function renderDone() {
  const p = C.todayProgress(state, day);
  return `<div class="screen done ${ui.animate ? 'enter' : ''}">
    <header class="top"><p class="brand">${spark()} 복습 탐사대</p></header>
    <main class="body">
      <section class="done-card">
        ${spark('s1')}${spark('s2')}${spark('s3')}
        ${robot(132, 'float')}
        <p class="done-t">${p.total}문제 완료!</p>
        <p class="done-s">별 ${p.done}개를 밝혔어요.</p>
        <p class="done-x">${spark()} × ${p.done}</p>
      </section>
      <p class="empty">더 풀고 싶으면 무한 모드로 가요.</p>
      <button class="btn primary" data-act="infinite">무한 모드 시작</button>
    </main>
    ${tabsHTML()}
  </div>`;
}

// ── 로그인 ──────────────────────────────────────────────
function renderLogin(err = '') {
  return `<div class="screen login enter">
    <main class="body">
      <section class="hero"><div><p class="hero-k">복습 탐사대</p><p class="hero-n sm">로그인</p><p class="hero-d">우리의 공부 계정으로<br>들어와요.</p></div>${robot(100, 'float')}</section>
      <form class="login-form" data-form="login">
        <input name="email" type="email" autocomplete="username" placeholder="이메일" required>
        <input name="pw" type="password" autocomplete="current-password" placeholder="비밀번호" required>
        ${err ? `<p class="err">${esc(err)}</p>` : ''}
        <button class="btn primary" type="submit">로그인</button>
      </form>
    </main>
  </div>`;
}

// ── 단원 안내 시트 ───────────────────────────────────────
function openUnitSheet(uid) {
  const on = !!state.units[uid];
  const u = unitById(uid);
  const back = document.createElement('div');
  back.className = 'sheet-back';
  back.innerHTML = `<div class="sheet" role="dialog" aria-label="${esc(unitName(uid))}">
    <div class="grab"></div>
    <p class="sheet-t">${esc(unitName(uid))}</p>
    <p class="sheet-d">카드 ${u.cards.length}장 · 교재 ${u.cards[0].p}~${u.cards[u.cards.length - 1].p}쪽</p>
    ${on
      ? `<button class="btn primary" data-sheet="replay">이 단원만 다시 풀기</button>
         <button class="btn ghost danger" data-sheet="remove">탐사 지도에서 빼기</button>
         <p class="sheet-n">빼도 지금까지의 기록은 남아요. 다시 추가하면 이어서 복습해요.</p>`
      : `<button class="btn primary" data-sheet="add">탐사 지도에 추가</button>
         <p class="sheet-n">추가하면 오늘의 빈 자리부터 이 단원 문제가 배정돼요.</p>`}
    <button class="btn ghost" data-sheet="close">닫기</button>
  </div>`;
  document.body.appendChild(back);
  requestAnimationFrame(() => back.classList.add('open'));
  const close = () => { back.classList.remove('open'); setTimeout(() => back.remove(), prefersReduced ? 0 : 320); };
  back.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-sheet]');
    if (e.target === back || b?.dataset.sheet === 'close') return close();
    if (!b) return;
    close();
    if (b.dataset.sheet === 'replay') startInfinite(uid);
    if (b.dataset.sheet === 'add') addUnit(uid);
    if (b.dataset.sheet === 'remove') removeUnit(uid);
  });
}

async function addUnit(uid) {
  await guardDay();
  await save((latest) => {
    const units = { ...latest.units, [uid]: { addedAt: day } };
    let st = { ...latest, units };
    st = C.ensureToday(st, idx, day).state;
    st = C.topUp(st, idx, day).state;
    return { state: st, changed: true };
  }).then(() => toast(`탐사 지도에 ${uid}장을 추가했어요.`)).catch(() => {});
}

async function removeUnit(uid) {
  await save((latest) => {
    const units = { ...latest.units };
    delete units[uid];
    return { state: { ...latest, units }, changed: true };
  }).then(() => toast(`탐사 지도에서 ${uid}장을 뺐어요.`)).catch(() => {});
}

// ── 렌더 & 이벤트 ───────────────────────────────────────
function render() {
  let html;
  if (ui.screen === 'login') html = renderLogin(ui.loginErr);
  else if (!loaded) html = `<div class="boot">${robot(88, 'float')}<p>탐사 준비 중…</p></div>`;
  else if (ui.screen === 'quiz' && ui.session) html = renderQuiz();
  else if (ui.screen === 'done') html = renderDone();
  else html = renderHome();
  $app.innerHTML = html + `<div class="toast ${ui.toast ? 'show' : ''}" role="status">${esc(ui.toast)}</div>`;
  ui.animate = false;
}

$app.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const act = b.dataset.act;
  if (act === 'tab') {
    if (ui.tab === b.dataset.tab && ui.screen === 'home') return;
    if (ui.screen !== 'home') ui.session = null;
    ui.tab = b.dataset.tab; ui.screen = 'home'; ui.animate = true;
    history.replaceState(null, '', ui.tab === 'units' ? '#units' : '#');
    await guardDay();
    render();
  } else if (act === 'start-today') { if (!(await guardDay())) startToday(); }
  else if (act === 'infinite') { if (!(await guardDay())) startInfinite(null); }
  else if (act === 'done-screen') { ui.screen = 'done'; ui.animate = true; render(); }
  else if (act === 'home') { ui.screen = 'home'; ui.session = null; ui.animate = true; render(); }
  else if (act === 'pick') {
    ui.session.card.pick = Number(b.dataset.i);
    document.querySelectorAll('.choice').forEach((el) => {
      const on = el === b;
      el.classList.toggle('sel', on);
      el.setAttribute('aria-checked', on);
    });
    document.querySelector('[data-act="check"]')?.removeAttribute('disabled');
  }
  else if (act === 'check') checkAnswer();
  else if (act === 'hint') {
    const cs = ui.session.card;
    cs.input = document.querySelector('.answer-input')?.value || '';
    cs.hint = true; cs.pick = null; ui.animate = false; render();
  }
  else if (act === 'grade') grade(b.dataset.g);
  else if (act === 'next') { if (!(await guardDay())) nextFree(); }
  else if (act === 'unit-add') addUnit(Number(b.dataset.unit));
  else if (act === 'unit-replay') { if (!(await guardDay())) startInfinite(Number(b.dataset.unit)); }
  else if (act === 'unit-info') openUnitSheet(Number(b.dataset.unit));
});

$app.addEventListener('input', (e) => {
  if (e.target.classList.contains('answer-input') && ui.session?.card) ui.session.card.input = e.target.value;
});
$app.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList.contains('answer-input')) { e.preventDefault(); checkAnswer(); }
});
$app.addEventListener('submit', async (e) => {
  if (e.target.dataset.form !== 'login') return;
  e.preventDefault();
  const f = new FormData(e.target);
  try { await store.login(f.get('email'), f.get('pw')); }
  catch (err) { ui.loginErr = '이메일 또는 비밀번호를 확인해 주세요.'; render(); }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && loaded && ui.screen === 'home') guardDay().then(() => render());
});

// ── 시작 ────────────────────────────────────────────────
(async function boot() {
  render();
  try {
    const [d, s] = await Promise.all([fetch(DECK_URL).then((r) => r.json()), createReviewStore(DECK_ID)]);
    deck = d; idx = C.indexDeck(deck); store = s;
  } catch (e) {
    $app.innerHTML = `<div class="boot"><p>불러오지 못했어요. 새로고침해 주세요.</p></div>`;
    return;
  }
  let unsub = null;
  store.onAuth((user) => {
    unsub && unsub(); unsub = null;
    if (!user) { loaded = false; ui.screen = 'login'; render(); return; }
    if (ui.screen === 'login') ui.screen = 'home';
    let first = true;
    unsub = store.subscribe((st) => {
      state = st;
      if (first) {
        first = false; loaded = true; ui.animate = true;
        syncDay().then(render);
        render();
        return;
      }
      // 문제 푸는 중에는 화면을 갈아엎지 않음(진행 표시만 반영)
      if (ui.screen === 'quiz') {
        const c = document.querySelector('.count');
        if (c && ui.session) { const { n, total } = progressInfo(); c.textContent = `${n} / ${total}`; }
      } else render();
    }, (e) => { console.error(e); toast('기록을 불러오지 못했어요.'); });
  });
})();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
