// 날짜 계산은 전부 한국 시간(KST, UTC+9, 서머타임 없음) 기준.
const KST_OFFSET = 9 * 3600 * 1000;
let offsetMs = 0; // 데모 모드에서 날짜를 바꿔 보기 위한 보정값

export function nowMs() {
  return Date.now() + offsetMs;
}

// 데모 전용: 오늘 날짜를 'YYYY-MM-DD'로 고정 (시각은 실제 현재 시각 유지)
export function setTodayOverride(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) return;
  const real = Date.now();
  const realKst = new Date(real + KST_OFFSET);
  const timeOfDay =
    realKst.getUTCHours() * 3600e3 + realKst.getUTCMinutes() * 60e3 + realKst.getUTCSeconds() * 1e3;
  const target = Date.parse(dateStr + 'T00:00:00Z') - KST_OFFSET + timeOfDay;
  offsetMs = target - real;
}

export function kstDateStr(ms) {
  return new Date(ms + KST_OFFSET).toISOString().slice(0, 10);
}

export function todayKST() {
  return kstDateStr(nowMs());
}

export function kstHHMM(ms) {
  return new Date(ms + KST_OFFSET).toISOString().slice(11, 16);
}

export function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
}

export function addDays(s, n) {
  return new Date(Date.parse(s + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
}

// 월=0 … 일=6
export function weekdayIdx(s) {
  return (new Date(s + 'T00:00:00Z').getUTCDay() + 6) % 7;
}

export function mondayOf(s) {
  return addDays(s, -weekdayIdx(s));
}

const WD = ['일', '월', '화', '수', '목', '금', '토'];
export function dateLabel(s) {
  const d = new Date(s + 'T00:00:00Z');
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${WD[d.getUTCDay()]})`;
}

export function shortDate(s) {
  const d = new Date(s + 'T00:00:00Z');
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

/**
 * 현재 학습 단계.
 * - before: 커리큘럼 시작 전
 * - week:   1~N주차 (매주 1챕터)
 * - review: N주차가 끝난 뒤 ~ 시험 전날 (최종 복습 기간)
 * - exam:   시험 당일
 * - done:   시험 이후
 */
export function getPhase(today, start, exam, nWeeks) {
  const dExam = daysBetween(today, exam);
  if (dExam < 0) return { kind: 'done', dExam };
  if (dExam === 0) return { kind: 'exam', dExam };
  const dStart = daysBetween(start, today);
  if (dStart < 0) return { kind: 'before', dExam, daysToStart: -dStart, week: 1 };
  const week = Math.floor(dStart / 7) + 1;
  if (week <= nWeeks) return { kind: 'week', dExam, week };
  return { kind: 'review', dExam };
}

export function splitHM(sec) {
  const m = Math.floor(Math.max(0, sec) / 60);
  return { h: Math.floor(m / 60), m: m % 60 };
}

export function hmText(sec) {
  const { h, m } = splitHM(sec);
  if (h === 0) return `${m}분`;
  return `${h}시간 ${String(m).padStart(2, '0')}분`;
}

export function clockText(sec) {
  const s = Math.floor(Math.max(0, sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return [h, m, ss].map((v) => String(v).padStart(2, '0')).join(':');
}
