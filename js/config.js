// ─────────────────────────────────────────────────────────────
//  여기만 고치면 됨!
//  Firebase 콘솔 → 프로젝트 설정 → 내 앱 → "SDK 설정 및 구성"에 나오는
//  firebaseConfig 값을 그대로 붙여넣기.
//  apiKey가 비어 있으면 앱이 '데모 모드'(이 기기에만 저장)로 동작함.
// ─────────────────────────────────────────────────────────────
export const firebaseConfig = {
  apiKey: 'AIzaSyD3n15JbHIPAIRmRACRvFiTmgEkbVHRqzo',
  authDomain: 'study-duo-dae68.firebaseapp.com',
  projectId: 'study-duo-dae68',
  storageBucket: 'study-duo-dae68.firebasestorage.app',
  messagingSenderId: '420102682191',
  appId: '1:420102682191:web:8ba1e32f06390336609c3a',
};

// 둘이 같이 쓰는 방 이름. 바꿀 필요 없음.
export const ROOM_ID = 'main';
