// 복습 탐사대 — 화면과 무관한 규칙만 모아둔 파일 (테스트: tests/review-core.test.mjs)
//
// 저장 형태 (users/{uid}/review/{deckId} 문서 하나)
//   units: { '1': { addedAt: 'YYYY-MM-DD' }, ... }        탐사 지도에 추가한 단원
//   cards: { cardId: { streak, due, last } }                 streak = 힌트 없이 연속 '기억남' 횟수
//   today: { date, ids: [cardId...], done: { cardId: true } }

export const DAILY_MAX = 10;
export const INTERVALS = [3, 7, 14, 21]; // 기억남 1회째 3일 → 7 → 14 → 21, 이후 계속 21
export const SUBJECTIVE_AFTER = 2;       // 연속 2회 기억남 → 세 번째 출제부터 주관식

export function addDays(s, n) {
  return new Date(Date.parse(s + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
}

export function emptyState() {
  return { units: {}, cards: {}, today: { date: '', ids: [], done: {} } };
}

export function normalizeState(s) {
  const e = emptyState();
  if (!s) return e;
  return {
    units: s.units || {},
    cards: s.cards || {},
    today: {
      date: s.today?.date || '',
      ids: Array.isArray(s.today?.ids) ? s.today.ids : [],
      done: s.today?.done || {},
    },
  };
}

// 덱(JSON) → 교재 순서 목록과 조회표
export function indexDeck(deck) {
  const order = [];
  const byId = {};
  const unitOf = {};
  deck.units.forEach((u) => {
    u.cards.forEach((c) => {
      byId[c.id] = c;
      unitOf[c.id] = u.id;
      order.push(c.id);
    });
  });
  const rank = {};
  order.forEach((id, i) => (rank[id] = i));
  return { order, byId, unitOf, rank };
}

export function activeUnitIds(state) {
  return Object.keys(state.units || {}).map(Number).sort((a, b) => a - b);
}

// 이 카드를 지금 어떤 방식으로 보여줄지
export function modeOf(cardState) {
  return (cardState?.streak || 0) >= SUBJECTIVE_AFTER ? 'subjective' : 'choice';
}

// 기억남을 누르면 며칠 뒤에 다시 볼지 (지금의 연속 횟수 기준)
export function rememberDays(cardState) {
  const next = (cardState?.streak || 0) + 1;
  return INTERVALS[Math.min(next, INTERVALS.length) - 1];
}

export function intervalLabel(days) {
  return days === 1 ? '내일' : `${days}일 뒤`;
}

// 저장할 카드 상태 계산. grade: 'remember' | 'again'
export function applyGrade(cardState, grade, today) {
  if (grade === 'remember') {
    const days = rememberDays(cardState);
    return { streak: (cardState?.streak || 0) + 1, due: addDays(today, days), last: today };
  }
  return { streak: 0, due: addDays(today, 1), last: today };
}

// 오늘 배정 후보: 활성 단원의 밀린 문제 → 오늘 예정 → 미풀이. 같은 날짜면 교재 순서.
export function candidates(state, idx, today, exclude = new Set()) {
  const units = new Set(activeUnitIds(state));
  const overdue = [];
  const dueToday = [];
  const unseen = [];
  for (const id of idx.order) {
    if (!units.has(idx.unitOf[id]) || exclude.has(id)) continue;
    const cs = state.cards[id];
    if (!cs || !cs.due) unseen.push(id);
    else if (cs.due < today) overdue.push(id);
    else if (cs.due === today) dueToday.push(id);
  }
  overdue.sort((a, b) =>
    state.cards[a].due < state.cards[b].due ? -1 : state.cards[a].due > state.cards[b].due ? 1 : idx.rank[a] - idx.rank[b]
  );
  return [...overdue, ...dueToday, ...unseen];
}

// 날짜가 바뀌었으면 새 목록, 같으면 그대로(빈 자리만 채우기는 topUp에서)
export function ensureToday(state, idx, today) {
  if (state.today.date === today) return { state, changed: false };
  const ids = candidates(state, idx, today).slice(0, DAILY_MAX);
  return { state: { ...state, today: { date: today, ids, done: {} } }, changed: true };
}

// 오늘 10개 미만으로 시작했고 단원이 새로 추가되면 빈 자리만 채움
export function topUp(state, idx, today) {
  if (state.today.date !== today || state.today.ids.length >= DAILY_MAX) return { state, changed: false };
  const have = new Set(state.today.ids);
  const extra = candidates(state, idx, today, have).slice(0, DAILY_MAX - state.today.ids.length);
  if (!extra.length) return { state, changed: false };
  return { state: { ...state, today: { ...state.today, ids: [...state.today.ids, ...extra] } }, changed: true };
}

export function isAssignedToday(state, id, today) {
  return state.today.date === today && state.today.ids.includes(id);
}

export function todayProgress(state, today) {
  if (state.today.date !== today) return { total: 0, done: 0, remaining: [] };
  const remaining = state.today.ids.filter((id) => !state.today.done[id]);
  return { total: state.today.ids.length, done: state.today.ids.length - remaining.length, remaining };
}

// 복습 버튼을 눌렀을 때 저장 내용. 트랜잭션 안에서 '최신 상태'로 다시 호출됨.
// 반환: { state, saved, reason }
export function commitReview(latest, cardId, grade, today) {
  const s = normalizeState(latest);
  if (s.today.date !== today) return { state: s, saved: false, reason: 'date-changed' };
  if (!s.today.ids.includes(cardId)) return { state: s, saved: false, reason: 'not-assigned' };
  if (s.today.done[cardId] || s.cards[cardId]?.last === today) return { state: s, saved: false, reason: 'already' };
  const next = applyGrade(s.cards[cardId], grade, today);
  return {
    state: {
      ...s,
      cards: { ...s.cards, [cardId]: next },
      today: { ...s.today, done: { ...s.today.done, [cardId]: true } },
    },
    saved: true,
    reason: 'ok',
  };
}

// 주관식 채점: 공백·대소문자만 정리하고 허용 답안과 비교
export function normalizeAnswer(s) {
  return String(s || '').replace(/\s+/g, '').toLowerCase();
}

export function checkSubjective(card, input) {
  const v = normalizeAnswer(input);
  if (!v) return false;
  return (card.acc || []).some((a) => normalizeAnswer(a) === v);
}

// 무한 모드 한 바퀴: 오늘 배정된 미완료(범위 안) 먼저, 나머지는 섞어서
export function buildLap(state, idx, today, scopeUnits, rand = Math.random) {
  const scope = new Set(scopeUnits);
  const inScope = idx.order.filter((id) => scope.has(idx.unitOf[id]));
  const first = state.today.date === today
    ? state.today.ids.filter((id) => !state.today.done[id] && scope.has(idx.unitOf[id]))
    : [];
  const firstSet = new Set(first);
  const rest = inScope.filter((id) => !firstSet.has(id));
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [...first, ...rest];
}

// 단원 탭: 단원별 오늘 남은 문제 수
export function remainingByUnit(state, idx, today) {
  const out = {};
  if (state.today.date !== today) return out;
  for (const id of state.today.ids) {
    if (state.today.done[id]) continue;
    const u = idx.unitOf[id];
    out[u] = (out[u] || 0) + 1;
  }
  return out;
}
