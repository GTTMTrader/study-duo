// Firebase(Firestore + Authentication) 저장소.
// 모든 기기가 같은 데이터를 실시간으로 구독함.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
  doc,
  collection,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig, ROOM_ID } from './config.js';
import { DEFAULT_ROOM } from './defaults.js';
import { nowMs, kstDateStr } from './dates.js';
import { deviceLabel } from './device.js';

export function createFirebaseStore() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  let db;
  try {
    // 오프라인 캐시: 지하철 등에서 끊겨도 타이머/체크가 저장됐다가 연결되면 올라감
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch (e) {
    db = initializeFirestore(app, { localCache: memoryLocalCache() });
  }

  const roomRef = doc(db, 'rooms', ROOM_ID);
  const col = (name) => collection(db, 'rooms', ROOM_ID, name);
  const sub = (name, id) => doc(db, 'rooms', ROOM_ID, name, id);

  const listeners = new Set();
  const errorListeners = new Set();
  let unsubs = [];
  const state = {
    mode: 'firebase',
    authReady: false,
    user: null,
    roomLoaded: false,
    room: null,
    members: {},
    sessions: [],
    active: {},
    progress: {},
    questions: {},
    answers: {},
  };

  const emit = () => listeners.forEach((fn) => fn(state));
  const fail = (e) => errorListeners.forEach((fn) => fn(e));

  function stopListening() {
    unsubs.forEach((u) => u());
    unsubs = [];
  }

  // 문제은행 규칙이 아직 게시 안 됐을 때 알아보기 쉽게 표시
  const failQuiz = (e) => { e.where = 'quiz'; fail(e); };
  const mapListener = (name, key) =>
    onSnapshot(
      col(name),
      (snap) => {
        const o = {};
        snap.forEach((d) => (o[d.id] = { id: d.id, ...d.data() }));
        state[key] = o;
        emit();
      },
      failQuiz
    );

  function startListening(uid) {
    stopListening();
    unsubs.push(mapListener('questions', 'questions'));
    unsubs.push(mapListener('answers', 'answers'));
    unsubs.push(
      onSnapshot(
        roomRef,
        (snap) => {
          if (!snap.exists()) {
            // 처음 접속한 사람이 기본 설정으로 방을 만듦
            setDoc(roomRef, { ...DEFAULT_ROOM, createdAt: nowMs() }).catch(fail);
            state.room = DEFAULT_ROOM;
          } else {
            state.room = { ...DEFAULT_ROOM, ...snap.data() };
          }
          state.roomLoaded = true;
          emit();
        },
        fail
      )
    );
    let memberChecked = false;
    unsubs.push(
      onSnapshot(
        col('members'),
        (snap) => {
          const m = {};
          snap.forEach((d) => (m[d.id] = d.data()));
          state.members = m;
          if (!memberChecked) {
            memberChecked = true;
            const mine = m[uid] || {};
            setDoc(
              sub('members', uid),
              { email: state.user.email, name: mine.name || '', lastSeen: nowMs() },
              { merge: true }
            ).catch(fail);
          }
          emit();
        },
        fail
      )
    );
    unsubs.push(
      onSnapshot(
        col('sessions'),
        (snap) => {
          const list = [];
          snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
          list.sort((a, b) => b.startAt - a.startAt);
          state.sessions = list;
          emit();
        },
        fail
      )
    );
    unsubs.push(
      onSnapshot(
        col('active'),
        (snap) => {
          const a = {};
          snap.forEach((d) => (a[d.id] = d.data()));
          state.active = a;
          emit();
        },
        fail
      )
    );
    unsubs.push(
      onSnapshot(
        col('progress'),
        (snap) => {
          const p = {};
          snap.forEach((d) => (p[d.id] = d.data()));
          state.progress = p;
          emit();
        },
        fail
      )
    );
  }

  onAuthStateChanged(auth, (user) => {
    state.authReady = true;
    if (user) {
      state.user = { uid: user.uid, email: user.email };
      startListening(user.uid);
    } else {
      stopListening();
      Object.assign(state, {
        user: null,
        roomLoaded: false,
        room: null,
        members: {},
        sessions: [],
        active: {},
        progress: {},
        questions: {},
        answers: {},
      });
    }
    emit();
  });

  const uid = () => state.user.uid;
  const myActive = () => state.active[uid()];

  return {
    state,
    subscribe(fn) {
      listeners.add(fn);
      fn(state);
      return () => listeners.delete(fn);
    },
    onError(fn) {
      errorListeners.add(fn);
    },
    async login(email, password) {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    },
    async logout() {
      await signOut(auth);
    },

    // ── 타이머 ──
    async startTimer({ type, chapter }) {
      const now = nowMs();
      await setDoc(sub('active', uid()), {
        type,
        chapter,
        sessionStart: now,
        segStart: now,
        accumSec: 0,
        paused: false,
        device: deviceLabel(),
      });
    },
    async pauseTimer() {
      const a = myActive();
      if (!a || a.paused) return;
      const now = nowMs();
      await updateDoc(sub('active', uid()), {
        accumSec: a.accumSec + (now - a.segStart) / 1000,
        segStart: null,
        paused: true,
      });
    },
    async resumeTimer() {
      const a = myActive();
      if (!a || !a.paused) return;
      await updateDoc(sub('active', uid()), { segStart: nowMs(), paused: false });
    },
    async stopTimer(overrideSec) {
      const a = myActive();
      if (!a) return null;
      const now = nowMs();
      const dur = Math.round(
        overrideSec ?? a.accumSec + (a.paused ? 0 : (now - a.segStart) / 1000)
      );
      const batch = writeBatch(db);
      if (dur >= 60) {
        // 문서 id를 시작시각으로 고정 → 두 기기에서 동시에 종료해도 중복 저장 안 됨
        batch.set(sub('sessions', `${uid()}_${a.sessionStart}`), {
          uid: uid(),
          type: a.type,
          chapter: a.chapter,
          startAt: a.sessionStart,
          endAt: now,
          durationSec: dur,
          dateKST: kstDateStr(a.sessionStart),
          device: a.device || '',
        });
      }
      batch.delete(sub('active', uid()));
      await batch.commit();
      return dur;
    },
    async discardTimer() {
      await deleteDoc(sub('active', uid()));
    },
    async updateSession(id, patch) {
      await updateDoc(sub('sessions', id), patch);
    },
    async deleteSession(id) {
      await deleteDoc(sub('sessions', id));
    },

    // ── 문제은행 ──
    async saveQuestion(chapter, slot, { text, choices, answer, explanation }) {
      const id = `${uid()}_${chapter}_${slot}`;
      const prev = state.questions[id];
      await setDoc(sub('questions', id), {
        author: uid(), chapter, slot, text, choices, answer, explanation: explanation || '',
        createdAt: prev?.createdAt || nowMs(), updatedAt: nowMs(),
      });
    },
    async deleteQuestion(id) {
      await deleteDoc(sub('questions', id));
    },
    async answerQuestion(q, choice) {
      const id = `${uid()}_${q.id}`;
      const correct = choice === q.answer;
      const prev = state.answers[id];
      const now = nowMs();
      if (!prev) {
        await setDoc(sub('answers', id), {
          uid: uid(), qid: q.id, author: q.author, chapter: q.chapter, slot: q.slot,
          choice, correct, lastChoice: choice, lastCorrect: correct, attempts: 1, at: now, lastAt: now,
        });
      } else {
        await updateDoc(sub('answers', id), { lastChoice: choice, lastCorrect: correct, attempts: (prev.attempts || 1) + 1, lastAt: now });
      }
      return correct;
    },

    // ── 진도 ──
    async setConcept(chapter, list) {
      await setDoc(
        sub('progress', uid()),
        { concept: { [chapter]: list } },
        { merge: true }
      );
    },
    async setPractice(chapter, key, list) {
      await setDoc(
        sub('progress', uid()),
        { practice: { [chapter]: { [key]: list } } },
        { merge: true }
      );
    },
    async setWorkbook(chapter, key, value) {
      await setDoc(
        sub('progress', uid()),
        { workbook: { [chapter]: { [key]: value } } },
        { merge: true }
      );
    },

    // ── 설정 ──
    async updateRoom(patch) {
      await setDoc(roomRef, patch, { merge: true });
    },
    // 백업 복원: 이미 내 uid로 바꿔 둔 데이터를 묶어서 저장 (한 번에 최대 400건씩)
    async restoreMine({ room, name, progress, questions, answers, sessions }) {
      const ops = [];
      if (room) ops.push((b) => b.set(roomRef, room, { merge: true }));
      if (name != null) ops.push((b) => b.set(sub('members', uid()), { name }, { merge: true }));
      if (progress) ops.push((b) => b.set(sub('progress', uid()), progress));
      for (const q of questions) { const { id, ...d } = q; ops.push((b) => b.set(sub('questions', id), d)); }
      for (const a of answers) { const { id, ...d } = a; ops.push((b) => b.set(sub('answers', id), d)); }
      for (const s of sessions) { const { id, ...d } = s; ops.push((b) => b.set(sub('sessions', id), d)); }
      for (let i = 0; i < ops.length; i += 400) {
        const batch = writeBatch(db);
        ops.slice(i, i + 400).forEach((op) => op(batch));
        await batch.commit();
      }
      return ops.length;
    },
    async updateMyName(name) {
      await setDoc(sub('members', uid()), { name }, { merge: true });
    },
  };
}
