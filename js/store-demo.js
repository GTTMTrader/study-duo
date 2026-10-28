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
    async deleteSession(id) {
      data.sessions = data.sessions.filter((s) => s.id !== id);
      commit();
    },
    async setConcept(chapter, list) {
      prog().concept = { ...(prog().concept || {}), [chapter]: list };
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
    async updateMyName(name) {
      data.members[ME] = { ...data.members[ME], name };
      commit();
    },
  };
}
