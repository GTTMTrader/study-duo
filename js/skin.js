// 화면 스킨(색 테마). 이 기기에만 저장 — 상대 화면은 각자 고른 스킨.
// 실제 색은 styles.css 의 :root[data-skin='…'] 에 있음. index.html 의 짧은 스크립트가 첫 화면 전에 미리 적용(깜빡임 방지).
export const SKINS = [
  { id: 'blue', name: '파랑', color: '#4168eb' },
  { id: 'violet', name: '보라', color: '#6d3df2' },
  { id: 'teal', name: '청록', color: '#0f766e' },
  { id: 'green', name: '초록', color: '#15803d' },
  { id: 'orange', name: '주황', color: '#c2410c' },
  { id: 'pink', name: '핑크', color: '#d0306c' },
  { id: 'mono', name: '블랙', color: '#222222' },
];
const KEY = 'studyduo-skin';

export function getSkin() {
  try {
    const v = localStorage.getItem(KEY);
    if (SKINS.some((s) => s.id === v)) return v;
  } catch (e) {}
  return 'blue';
}

// 흰색에 살짝 섞은 배경색 (상단바 색에 사용)
function tintBg(hex, pct = 0.03) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(255 + (c - 255) * pct));
  return '#' + ch.map((c) => c.toString(16).padStart(2, '0')).join('');
}

export function applySkin(id) {
  const root = document.documentElement;
  if (id === 'blue') delete root.dataset.skin;
  else root.dataset.skin = id;
  const s = SKINS.find((x) => x.id === id) || SKINS[0];
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', tintBg(id === 'mono' ? '#7a7a7a' : s.color));
}

export function setSkin(id) {
  try { localStorage.setItem(KEY, id); } catch (e) {}
  applySkin(id);
}
