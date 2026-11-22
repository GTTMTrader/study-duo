// 실행: node tests/solo-plan.test.mjs  (내 공부 일정 엔진·데이터 가져오기 테스트)
import fs from 'node:fs';
import assert from 'node:assert/strict';
const R = new URL('../js/', import.meta.url).href;
const { normalizeContent, mergeContent, contentCounts } = await import(R + 'solo-content.js');
const P = await import(R + 'solo-plan.js');
const D = await import(R + 'dates.js');
const raw = JSON.parse(fs.readFileSync(new URL('../data/moneyprinter-marupong.json', import.meta.url), 'utf8'));
const c = normalizeContent(raw);
const n = contentCounts(c);
console.log('counts', n);
assert.equal(n.sessions, 33); assert.equal(n.items, 124); assert.equal(n.uniqueVideos, 99); assert.equal(n.weeks, 16); assert.equal(n.blog, 91);
assert.equal(n.seconds, 310222);
// 재가져오기 2회 → 개수 동일
const twice = mergeContent(mergeContent(c, normalizeContent(raw)), normalizeContent(raw));
assert.deepEqual(contentCounts(twice), n); console.log('re-import x2: no duplicates ✓');

const at = (date, hh = 21) => Date.parse(`${date}T${String(hh).padStart(2, '0')}:00:00+09:00`);
let settings = P.settingsOf({ start: { seq: 1 } }, c);
let prog = {};
// 11/20(금): 공부일 → 1회차가 오늘 (PDF 날짜와 무관하게 1회차)
let p = P.plan(c, settings, prog, '2026-11-20');
assert.equal(p.todayNext[0].id, 'MP-A-01'); console.log('11/20 today:', p.todayNext.map(u => u.id), 'next study', p.nextStudyDate);
// 시작 회차 미지정이어도 날짜로 자동 완료 X
const p0 = P.plan(c, P.settingsOf({}, c), {}, '2026-11-20');
assert.equal(p0.units.filter(u => u.done).length, 0); console.log('no auto-complete by date ✓');

// 화(11/24) 못 함 → 수(11/25)에 같은 회차 그대로
settings = P.settingsOf({ start: { seq: 5 } }, c);
p = P.plan(c, settings, prog, '2026-11-24');
assert.equal(p.todayNext[0].id, 'MP-A-05');
p = P.plan(c, settings, prog, '2026-11-25');
assert.equal(p.todayNext[0].id, 'MP-A-05'); console.log('missed Tue → carried to Wed ✓');
// 부분 진행 상태와 링크가 유지됨
const s5 = c.sessions.find(s => s.id === 'MP-A-05');
prog = { assign: { [s5.items[0].key]: { st: 'completed', at: at('2026-11-24') } } };
p = P.plan(c, settings, prog, '2026-11-25');
assert.equal(p.todayNext[0].id, 'MP-A-05'); assert.equal(p.todayNext[0].info.doneN, 1);
assert.equal(p.todayNext[0].info.items[0].url, s5.items[0].url); console.log('partial progress + links kept ✓');
// 이번 주 화·수를 빼고 금·토만 → 월요일 기준 금요일에 A-05
const s2 = { ...settings, weekOverrides: { '2026-11-23': [5, 6] } };
p = P.plan(c, s2, prog, '2026-11-23');
assert.equal(p.nextStudyDate, '2026-11-27'); assert.deepEqual(p.proj['2026-11-27'], ['MP-A-05']); assert.deepEqual(p.proj['2026-11-28'], ['MP-A-06']);
console.log('Tue→Fri move without loss ✓', p.proj['2026-11-27'], p.proj['2026-11-28']);
// 분량 2로 바꾸면 하루 2회차
const s3 = { ...settings, perDay: { ...settings.perDay, 5: 2 } };
p = P.plan(c, s3, prog, '2026-11-27'); assert.deepEqual(p.todayNext.map(u => u.id), ['MP-A-05', 'MP-A-06']); console.log('per-day quota 2 ✓');
// 오늘 1회차 끝내면 오늘 분량 완료, 다음은 다음 공부일
const all5 = Object.fromEntries(s5.items.map(i => [i.key, { st: 'completed', at: at('2026-11-27') }]));
p = P.plan(c, settings, { assign: all5 }, '2026-11-27');
assert.equal(p.doneToday[0].id, 'MP-A-05'); assert.equal(p.rest, 0); assert.equal(p.nextAfterToday.id, 'MP-A-06');
// 미리 하기 +1
p = P.plan(c, { ...settings, extra: { '2026-11-27': 1 } }, { assign: all5 }, '2026-11-27'); assert.equal(p.todayNext[0].id, 'MP-A-06'); console.log('done today + pull ahead ✓');
// 같은 영상이 다른 회차에 나와도 따로 체크
const vidCount = {}; c.sessions.forEach(s => s.items.forEach(i => (vidCount[i.vid] ||= []).push(i.key)));
const rep = Object.entries(vidCount).find(([, k]) => k.length > 1);
const pr = { assign: { [rep[1][0]]: { st: 'completed', at: at('2026-11-20') } } };
const info = (key) => P.units(c, P.settingsOf({ start: { seq: 1 } }, c), pr).flatMap(u => u.type === 'session' ? u.info.items : []).find(i => i.key === key);
assert.equal(info(rep[1][0]).st, 'completed'); assert.equal(info(rep[1][1]).st, 'not_started'); console.log('repeat video independent ✓', rep[0]);
// 수동 완료 / 되돌리기
const man = { session: { 'MP-A-01': { manual: 'done', at: at('2026-11-20') } } };
assert.equal(P.plan(c, P.settingsOf({ start: { seq: 1 } }, c), man, '2026-11-21').todayNext[0].id, 'MP-A-02');
const und = { assign: Object.fromEntries(c.sessions[0].items.map(i => [i.key, { st: 'completed', at: at('2026-11-20') }])), session: { 'MP-A-01': { manual: 'undone' } } };
assert.equal(P.plan(c, P.settingsOf({ start: { seq: 1 } }, c), und, '2026-11-21').todayNext[0].id, 'MP-A-01'); console.log('manual done / undo ✓');
// B 단계는 A 끝나기 전 잠금
assert.equal(P.plan(c, settings, {}, '2026-11-20').phases.B.unlocked, false);
// ── 주차별 기록 ──
{
  const s1 = P.settingsOf({ start: { seq: 1, at: at('2026-11-20') } }, c);
  const k = c.sessions[0].items.map(i => i.key);
  const pr = { assign: { [k[0]]: { st: 'completed', at: at('2026-11-20') }, [k[1]]: { st: 'completed', at: at('2026-11-21') }, [k[2]]: { st: 'completed', at: at('2026-11-25') }, [k[3]]: { st: 'in_progress', at: at('2026-11-25') } } };
  const blog = { 'MARU-MANUAL-01': { read: at('2026-11-24') } };
  const w = P.weeklyLog(c, s1, pr, blog, '2026-11-26');
  assert.equal(w.length, 2); assert.equal(w[0].idx, 2); assert.equal(w[0].videos, 1); assert.equal(w[0].blogs, 1); assert.equal(w[1].videos, 2);
  assert.equal(w[1].days[4], 1); assert.equal(w[1].days[5], 1);
  console.log('weekly log ✓', w.map(x => `${x.idx}주차 영상${x.videos}`).join(', '));
}
// ── 회독 ──
{
  const all1 = { session: Object.fromEntries(c.sessions.map(s => [s.id, { manual: 'done', at: at('2026-12-01') }])), assign: { [c.sessions[0].items[0].key]: { st: 'completed', at: at('2026-11-20'), note: '1회독 메모' } } };
  let s2 = P.settingsOf({ start: { seq: 1, at: at('2026-11-20') } }, c);
  let p1 = P.plan(c, s2, P.roundProg(all1, 1), '2026-12-02');
  assert.equal(p1.phases.A.complete, true);
  s2 = P.settingsOf({ start: { seq: 1, at: at('2026-11-20') }, round: 2, roundStarts: { 2: { seq: 1, at: at('2026-12-02') } } }, c);
  const prog2 = { ...all1, rounds: { 2: { assign: { [c.sessions[0].items[1].key]: { st: 'completed', at: at('2026-12-03') } } } } };
  const p2 = P.plan(c, P.roundSettings(s2, 2), P.roundProg(prog2, 2), '2026-12-03');
  assert.equal(p2.queue[0].id, 'MP-A-01'); assert.equal(p2.queue[0].info.doneN, 1);
  assert.equal(P.roundProg(prog2, 1).assign[c.sessions[0].items[0].key].note, '1회독 메모');
  const rs = P.roundSummary(c, s2, prog2);
  assert.equal(rs.length, 2); assert.equal(rs[0].finished, true); assert.equal(rs[1].videos, 1);
  const wl = P.weeklyLog(c, s2, prog2, {}, '2026-12-03');
  assert.ok(wl[0].rounds.has(2) && wl.some(x => x.rounds.has(1)));
  assert.deepEqual(P.roundPatch(2, { assign: { x: 1 } }), { rounds: { 2: { assign: { x: 1 } } } });
  console.log('rounds ✓ (2회독은 01회차부터 새로, 1회독 기록 보관)');
}
console.log('ALL PLAN TESTS PASSED');
