// 실행: node tests/review-core.test.mjs  (복습 탐사대 규칙 테스트)
import fs from 'node:fs';
import assert from 'node:assert/strict';
const C = await import(new URL('../js/review-core.js', import.meta.url).href);
const deck = JSON.parse(fs.readFileSync(new URL('../data/nsca-sports-nutrition.json', import.meta.url), 'utf8'));
const idx = C.indexDeck(deck);
const D1 = '2026-11-30';

// 덱 기본 검사
let total = 0;
for (const u of deck.units) for (const c of u.cards) {
  total++;
  assert.equal(c.c.length, 4, c.id);
  assert.equal(new Set(c.c).size, 4, c.id);
  assert.ok(c.a >= 0 && c.a < 4, c.id);
  assert.ok(c.acc.length >= 1 && c.acc[0] === c.c[c.a], c.id + ' 첫 허용답안 = 정답 보기');
  assert.ok(C.checkSubjective(c, c.c[c.a]), c.id);
  assert.ok(c.p > 0 && c.pdf > 0, c.id);
}
assert.equal(total, idx.order.length);

// 단원 없으면 배정 0개
let s = C.emptyState();
s = C.ensureToday(s, idx, D1).state;
assert.equal(s.today.ids.length, 0);

// 1장 추가 → 빈 자리 채우기로 10개, 교재 순서
s = { ...s, units: { 1: { addedAt: D1 } } };
s = C.topUp(s, idx, D1).state;
assert.deepEqual(s.today.ids, idx.order.slice(0, 10));

// 10개가 찬 뒤 단원을 더 추가해도 그대로
const before = s.today.ids.slice();
s = { ...s, units: { ...s.units, 2: { addedAt: D1 } } };
assert.equal(C.topUp(s, idx, D1).changed, false);
assert.deepEqual(s.today.ids, before);

// 무한 모드에서 배정 카드 1개 먼저 완료 → 오늘 1/10, 남은 9
const first = s.today.ids[0];
let r = C.commitReview(s, first, 'remember', D1);
assert.equal(r.saved, true);
s = r.state;
let p = C.todayProgress(s, D1);
assert.equal(p.done, 1); assert.equal(p.remaining.length, 9);
assert.equal(s.cards[first].streak, 1);
assert.equal(s.cards[first].due, '2026-12-03'); // 3일 뒤

// 같은 카드·같은 날 두 번 저장 안 됨
r = C.commitReview(s, first, 'again', D1);
assert.equal(r.saved, false); assert.equal(r.reason, 'already');

// 배정 안 된 11번째 카드는 저장 안 됨(자유 연습)
const eleventh = idx.order[10];
r = C.commitReview(s, eleventh, 'remember', D1);
assert.equal(r.saved, false); assert.equal(r.reason, 'not-assigned');
assert.equal(s.cards[eleventh], undefined);

// 자정 넘어 이전 날짜 응답은 저장 안 됨
r = C.commitReview(s, s.today.ids[1], 'remember', '2026-12-01');
assert.equal(r.saved, false); assert.equal(r.reason, 'date-changed');

// 간격: 3 → 7 → 14 → 21 → 21, 연속 2회 후 주관식
let cs;
const days = [];
let d = D1;
for (let i = 0; i < 5; i++) {
  days.push(C.rememberDays(cs));
  cs = C.applyGrade(cs, 'remember', d);
}
assert.deepEqual(days, [3, 7, 14, 21, 21]);
assert.equal(C.modeOf({ streak: 0 }), 'choice');
assert.equal(C.modeOf({ streak: 1 }), 'choice');
assert.equal(C.modeOf({ streak: 2 }), 'subjective');
// 다시 보기 → 내일, 연속 0
const again = C.applyGrade({ streak: 3, due: D1 }, 'again', D1);
assert.deepEqual(again, { streak: 0, due: '2026-12-01', last: D1 });

// 다음 날 배정 순서: 밀린 → 오늘 예정 → 미풀이
let t = C.emptyState();
t.units = { 1: {} };
const [a, b, c2] = idx.order;
t.cards[a] = { streak: 0, due: '2026-12-02', last: D1 }; // 오늘 예정
t.cards[b] = { streak: 0, due: '2026-11-29', last: D1 }; // 밀림
t.cards[c2] = { streak: 0, due: '2026-12-10', last: D1 }; // 미래
t = C.ensureToday(t, idx, '2026-12-02').state;
assert.equal(t.today.ids[0], b);
assert.equal(t.today.ids[1], a);
assert.ok(!t.today.ids.includes(c2));
assert.equal(t.today.ids[2], idx.order[3]);

// 무한 모드: 오늘 미완료 먼저, 한 바퀴에 카드 한 번씩
const lap = C.buildLap(s, idx, D1, [1, 2]);
const pending = s.today.ids.filter((id) => !s.today.done[id]);
assert.deepEqual(lap.slice(0, pending.length), pending);
assert.equal(new Set(lap).size, lap.length);
assert.equal(lap.length, deck.units[0].cards.length + deck.units[1].cards.length);

// 주관식: 공백·대소문자 정리
const glut = deck.units[1].cards.find((x) => x.acc.includes('GLUT4'));
assert.ok(C.checkSubjective(glut, ' glut 4 '));
assert.ok(!C.checkSubjective(glut, 'GLUT2'));

console.log('ok', total, 'cards');
