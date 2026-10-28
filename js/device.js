export function deviceLabel() {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/.test(ua)) return '아이폰';
  if (/SM-|Galaxy|SAMSUNG/i.test(ua)) return '갤럭시';
  if (/Android/.test(ua)) return '안드로이드';
  if (/Windows/.test(ua)) return '윈도우';
  if (/Mac/.test(ua)) return '맥';
  return '기기';
}
