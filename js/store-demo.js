// 데모 저장소: Firebase 설정 전, 이 기기(localStorage)에만 저장.
// 주소 끝에 ?sample=1 을 붙이면 시연용 가짜 기록이 채워짐.
import { DEFAULT_ROOM } from './defaults.js';
import { nowMs, kstDateStr, todayKST, mondayOf, addDays, daysBetween } from './dates.js';
import { deviceLabel } from './device.js';

const KEY = 'studyduo-demo-v1';
const ME = 'me';
const FRIEND = 'friend';

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return null;
}

function blank() {
  return {
    room: JSON.parse(JSON.stringify(DEFAULT_ROOM)),
    members: { [ME]: { name: '', email: 'me@demo' }, [FRIEND]: { name: '', email: 'friend@demo' } },
    sessions: [],
    active: {},
    progress: {},
    questions: {},
    answers: {},
  };
}

function sampleData() {
  const d = blank();
  const today = todayKST();
  const mon = mondayOf(today);
  const KST = 9 * 3600e3;
  const at = (date, hh, mm) => Date.parse(date + 'T00:00:00Z') - KST + (hh * 60 + mm) * 60e3;
  const plan = [
    // [요일offset, 사람, 시작시, 분, 유형]
    [0, ME, 9, 65, '개념서'], [0, FRIEND, 20, 70, '개념서'],
    [1, ME, 21, 75, '개념서'], [1, FRIEND, 21, 45, '문제집'],
    [2, ME, 8, 80, '문제집'], [2, FRIEND, 19, 55, '개념서'],
    [3, ME, 20, 110, '개념서'], [3, FRIEND, 20, 65, '복습'],
    [4, ME, 21, 80, '복습'], [4, FRIEND, 22, 60, '문제집'],
    [5, ME, 10, 10, '복습'], [5, FRIEND, 14, 80, '개념서'],
    [6, ME, 9, 45, '개념서'], [6, ME, 10, 35, '문제집'], [6, FRIEND, 13, 50, '개념서'],
  ];
  const room = d.room;
  const dStart = daysBetween(room.curriculumStart, today);
  const ch = Math.min(Math.max(Math.floor(dStart / 7) + 1, 1), room.chapters.length);
  for (const [off, who, hh, min, type] of plan) {
    const date = addDays(mon, off);
    if (daysBetween(date, today) < 0) continue;
    const start = at(date, hh, who === ME && off === 6 && type === '문제집' ? 25 : 10);
    d.sessions.push({
      id: `${who}_${start}`,
      uid: who,
      type,
      chapter: ch,
      startAt: start,
      endAt: start + min * 60e3,
      durationSec: min * 60,
      dateKST: date,
      device: who === ME ? '갤럭시' : '윈도우',
    });
  }
  const q = (author, slot, text, choices, answer, explanation = '') => {
    const id = `${author}_${ch}_${slot}`;
    d.questions[id] = { id, author, chapter: ch, slot, text, choices, answer, explanation, createdAt: 0, updatedAt: 0 };
    return id;
  };
  q(FRIEND, 0, '다음 중 단당류가 아닌 것은?', ['포도당', '과당', '갈락토스', '자당', '리보스'], 3, '자당은 포도당+과당으로 된 이당류.');
  q(FRIEND, 1, '근육 글리코겐에 대한 설명으로 옳은 것은?', ['혈당 유지에 직접 쓰인다', '간 글리코겐보다 총량이 적다', '근육 자체의 에너지원으로 쓰인다', '운동 중에는 분해되지 않는다', '인슐린에 의해 분해된다'], 2);
  q(FRIEND, 2, '탄수화물 로딩을 하는 주된 목적은?', ['체지방 감소', '근 글리코겐 저장량 증가', '단백질 합성 촉진', '수분 배출', '혈중 케톤 증가'], 1);
  const mine = q(ME, 0, '혈당을 낮추는 호르몬은?', ['글루카곤', '에피네프린', '코르티솔', '인슐린', '성장호르몬'], 3);
  q(ME, 1, '식이섬유에 대한 설명으로 틀린 것은?', ['소화효소로 분해되지 않는다', '배변을 돕는다', '혈당 상승을 완만하게 한다', '1g당 9kcal를 낸다', '수용성과 불용성이 있다'], 3);
  d.answers[`${FRIEND}_${mine}`] = { id: `${FRIEND}_${mine}`, uid: FRIEND, qid: mine, author: ME, chapter: ch, slot: 0, choice: 0, correct: false, lastChoice: 0, lastCorrect: false, attempts: 1 };
  d.progress[ME] = { concept: { 2: [0, 1, 2, 3] }, workbook: { 2: { solved: true } } };
  d.progress[FRIEND] = { concept: { 2: [0, 1, 2] }, workbook: {} };
  return d;
}

export function createDemoStore({ sample = false } = {}) {
  let data = sample ? sampleData() : load() || blank();
  const listeners = new Set();
  const state = {
    mode: 'demo',
    authReady: true,
    user: { uid: ME, email: 'me@demo' },
    roomLoaded: true,
  };
  function sync() {
    state.room = data.room;
    state.members = data.members;
    state.sessions = [...data.sessions].sort((a, b) => b.startAt - a.startAt);
    state.active = data.active;
    state.progress = data.progress;
    state.questions = data.questions || {};
    state.answers = data.answers || {};
  }
  function commit() {
    if (!sample) {
      try {
        localStorage.setItem(KEY, JSON.stringify(data));
      } catch (e) {}
    }
    sync();
    listeners.forEach((fn) => fn(state));
  }
  sync();

  const prog = () => (data.progress[ME] ||= { concept: {}, workbook: {} });

  return {
    state,
    subscribe(fn) {
      listeners.add(fn);
      fn(state);
      return () => listeners.delete(fn);
    },
    onError() {},
    async login() {},
    async logout() {
      if (confirm('데모 데이터를 모두 지울까?')) {
        data = blank();
        commit();
      }
    },
    async startTimer({ type, chapter }) {
      const now = nowMs();
      data.active[ME] = {
        type, chapter, sessionStart: now, segStart: now, accumSec: 0, paused: false, device: deviceLabel(),
      };
      commit();
    },
    async pauseTimer() {
      const a = data.active[ME];
      if (!a || a.paused) return;
      a.accumSec += (nowMs() - a.segStart) / 1000;
      a.segStart = null;
      a.paused = true;
      commit();
    },
    async resumeTimer() {
      const a = data.active[ME];
      if (!a || !a.paused) return;
      a.segStart = nowMs();
      a.paused = false;
      commit();
    },
    async stopTimer(overrideSec) {
      const a = data.active[ME];
      if (!a) return null;
      const now = nowMs();
      const dur = Math.round(overrideSec ?? a.accumSec + (a.paused ? 0 : (now - a.segStart) / 1000));
      if (dur >= 60) {
        const id = `${ME}_${a.sessionStart}`;
        data.sessions = data.sessions.filter((s) => s.id !== id);
        data.sessions.push({
          id, uid: ME, type: a.type, chapter: a.chapter, startAt: a.sessionStart, endAt: now,
          durationSec: dur, dateKST: kstDateStr(a.sessionStart), device: a.device,
        });
      }
      delete data.active[ME];
      commit();
      return dur;
    },
    async discardTimer() {
      delete data.active[ME];
      commit();
    },
    async updateSession(id, patch) {
      data.sessions = data.sessions.map((s) => (s.id === id ? { ...s, ...patch } : s));
      commit();
    },
    async deleteSession(id) {
      data.sessions = data.sessions.filter((s) => s.id !== id);
      commit();
    },
    async setConcept(chapter, list) {
      prog().concept = { ...(prog().concept || {}), [chapter]: list };
      commit();
    },
    async saveQuestion(chapter, slot, { text, choices, answer, explanation }) {
      const id = `${ME}_${chapter}_${slot}`;
      data.questions ||= {};
      const prev = data.questions[id];
      data.questions[id] = { id, author: ME, chapter, slot, text, choices, answer, explanation: explanation || '', createdAt: prev?.createdAt || nowMs(), updatedAt: nowMs() };
      commit();
    },
    async deleteQuestion(id) {
      delete data.questions[id];
      commit();
    },
    async answerQuestion(q, choice) {
      data.answers ||= {};
      const id = `${ME}_${q.id}`;
      const correct = choice === q.answer;
      const prev = data.answers[id];
      data.answers[id] = prev
        ? { ...prev, lastChoice: choice, lastCorrect: correct, attempts: (prev.attempts || 1) + 1, lastAt: nowMs() }
        : { id, uid: ME, qid: q.id, author: q.author, chapter: q.chapter, slot: q.slot, choice, correct, lastChoice: choice, lastCorrect: correct, attempts: 1, at: nowMs(), lastAt: nowMs() };
      commit();
      return correct;
    },
    async setPractice(chapter, key, list) {
      const pr = (prog().practice ||= {});
      pr[chapter] = { ...(pr[chapter] || {}), [key]: list };
      commit();
    },
    async setWorkbook(chapter, key, value) {
      const wb = (prog().workbook ||= {});
      wb[chapter] = { ...(wb[chapter] || {}), [key]: value };
      commit();
    },
    async updateRoom(patch) {
      data.room = { ...data.room, ...patch };
      commit();
    },
    async restoreMine({ room, name, progress, questions, answers, sessions }) {
      if (room) data.room = { ...data.room, ...room };
      if (name != null) data.members[ME] = { ...data.members[ME], name };
      if (progress) data.progress[ME] = progress;
      data.questions ||= {}; data.answers ||= {};
      for (const q of questions) data.questions[q.id] = q;
      for (const a of answers) data.answers[a.id] = a;
      for (const s of sessions) { data.sessions = data.sessions.filter((x) => x.id !== s.id); data.sessions.push(s); }
      commit();
      return questions.length + answers.length + sessions.length;
    },
    async updateMyName(name) {
      data.members[ME] = { ...data.members[ME], name };
      commit();
    },
  };
}
