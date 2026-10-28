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
  };

  const emit = () => listeners.forEach((fn) => fn(state));
  const fail = (e) => errorListeners.forEach((fn) => fn(e));

  function stopListening() {
    unsubs.forEach((u) => u());
    unsubs = [];
  }

  function startListening(uid) {
    stopListening();
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

    // ── 진도 ──
    async setConcept(chapter, list) {
      await setDoc(
        sub('progress', uid()),
        { concept: { [chapter]: list } },
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
    async updateMyName(name) {
      await setDoc(sub('members', uid()), { name }, { merge: true });
    },
  };
}
