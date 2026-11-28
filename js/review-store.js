// 복습 탐사대 저장소: Firebase(users/{uid}/review/{deck}) 또는 이 기기 저장(데모)
import { firebaseConfig } from './config.js';
import { normalizeState } from './review-core.js';

const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';

function demoWanted() {
  const q = new URLSearchParams(location.search);
  return q.has('demo') || !firebaseConfig.apiKey;
}

export async function createReviewStore(deckId) {
  return demoWanted() ? createLocalStore(deckId) : createFirebaseStore(deckId);
}

// ── 데모: localStorage ──────────────────────────────────────
function createLocalStore(deckId) {
  const KEY = `review-demo-${deckId}`;
  const read = () => {
    try { return normalizeState(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch (e) { return normalizeState(null); }
  };
  let listener = null;
  return {
    mode: 'demo',
    onAuth(cb) { cb({ uid: 'demo', email: 'demo' }); },
    async login() {},
    async logout() {},
    subscribe(cb) { listener = cb; cb(read()); return () => (listener = null); },
    // fn(latest) → { state, changed?, ...meta }
    async update(fn) {
      const res = fn(read());
      if (res.changed !== false && res.state) {
        try { localStorage.setItem(KEY, JSON.stringify(res.state)); } catch (e) {}
        listener && listener(read());
      }
      return res;
    },
  };
}

// ── Firebase ─────────────────────────────────────────────────
async function createFirebaseStore(deckId) {
  const [{ initializeApp }, A, F] = await Promise.all([
    import(FB + 'firebase-app.js'),
    import(FB + 'firebase-auth.js'),
    import(FB + 'firebase-firestore.js'),
  ]);
  const app = initializeApp(firebaseConfig);
  const auth = A.getAuth(app);
  let db;
  try {
    db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });
  } catch (e) {
    db = F.initializeFirestore(app, { localCache: F.memoryLocalCache() });
  }
  let user = null;
  const ref = () => F.doc(db, 'users', user.uid, 'review', deckId);

  return {
    mode: 'firebase',
    onAuth(cb) { A.onAuthStateChanged(auth, (u) => { user = u; cb(u); }); },
    async login(email, pw) { await A.signInWithEmailAndPassword(auth, email.trim(), pw); },
    async logout() { await A.signOut(auth); },
    subscribe(cb, onErr) {
      return F.onSnapshot(ref(), (snap) => cb(normalizeState(snap.exists() ? snap.data() : null)), onErr);
    },
    // 최신 상태 확인과 저장을 한 트랜잭션으로
    async update(fn) {
      return F.runTransaction(db, async (tx) => {
        const snap = await tx.get(ref());
        const res = fn(normalizeState(snap.exists() ? snap.data() : null));
        if (res.changed !== false && res.state) {
          const { units, cards, today } = res.state;
          tx.set(ref(), { units, cards, today, updatedAt: Date.now() });
        }
        return res;
      });
    },
  };
}
