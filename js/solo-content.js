// 내 공부(머프 강의 + 마루둥둥 교재) 콘텐츠 데이터.
// 콘텐츠(제목·영상·링크·순서)와 내 진도(체크·메모)는 완전히 분리해서 다룸.
// 같은 JSON을 몇 번 다시 가져와도 ID 기준으로 덮어쓰기만 하므로 중복이 생기지 않고, 진도는 건드리지 않음.

export const DATASET_ID = 'moneyprinter-marupong-dual-study-curriculum';
export const CONTENT_URL = './data/moneyprinter-marupong.json';

export const COLLECTIONS = [
  { id: 'MANUAL', name: '매뉴얼' },
  { id: 'PRICE_REPORT', name: 'S/R 보고서' },
  { id: 'PA_PSYCHOLOGY', name: 'PA 심리' },
  { id: 'MASTER_CLASS', name: '마스터클래스' },
  { id: 'VPA', name: 'VPA' },
  { id: 'CRYPTO_WIZARDS', name: '인터뷰' },
];

const bySeq = (a, b) => a.seq - b.seq;

// 가져온 원본 JSON → 앱에서 쓰는 형태 (원본 제목·순서·ID·시간·링크 그대로)
export function normalizeContent(raw) {
  if (!raw || raw.dataset_id !== DATASET_ID) throw new Error('머프·마루둥둥 커리큘럼 파일이 아니에요');
  const policy = raw.app_schedule_policy || {};
  const sessions = (raw.phase_A_video_sessions || []).map((s) => ({
    id: s.id,
    seq: s.sequence,
    phase: 'A',
    title: String(s.title || '').trim(),
    pdfDate: s.planned_date_in_pdf || null,
    pdfWd: s.weekday_ko || '',
    sec: s.estimated_video_seconds || (s.video_items || []).reduce((t, v) => t + (v.duration_seconds || 0), 0),
    blogIds: s.suggested_optional_blog_article_ids || [],
    items: (s.video_items || []).map((v, i) => ({
      key: `${s.id}__${v.id}`, // 같은 영상이 다른 회차에 다시 나와도 회차별로 따로 체크
      id: v.id,
      vid: v.video_id,
      title: v.title,
      pl: v.source_playlist || '',
      dur: v.duration || '',
      sec: v.duration_seconds || 0,
      url: v.url,
      ios: v.ios_app_url || null,
      rev: !!v.review_repeat,
      order: i,
    })),
  })).sort(bySeq);

  const weeks = (raw.phase_B_C_weekly_tasks || []).map((w) => ({
    id: w.id,
    phase: w.phase,
    week: w.week,
    seq: (w.phase === 'B' ? 0 : 100) + w.week,
    title: String(w.title || '').trim(),
    goal: w.goal || '',
    refStart: w.reference_start_date || null,
    refEnd: w.reference_end_date || null,
    tasks: Object.entries(w.weekday_assignments || {})
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([k, text]) => ({ k: String(k), text })),
    videos: (w.review_videos || []).map((v) => ({ url: v.url, ios: v.ios_app_url || null, vid: (v.url.match(/[?&]v=([\w-]+)/) || [])[1] || '' })),
  })).sort(bySeq);

  const blog = (raw.marupong_blog_articles || []).map((b) => ({
    id: b.id,
    col: b.collection,
    seq: b.sequence,
    num: b.article_number,
    title: b.title,
    url: b.original_url || null, // 없으면 절대 추측해서 만들지 않음 → 글 목록 링크로 대체
    idx: b.collection_index_url || null,
    verified: !!b.url_verified,
    pri: b.recommended_priority || 'reference',
    origin: b.origin || '',
    minutes: b.estimated_read_minutes ?? null,
  }));

  return {
    datasetId: raw.dataset_id,
    version: raw.schema_version || '',
    generatedAt: raw.generated_at || '',
    sessions,
    weeks,
    blog,
    playlists: raw.playlist_sources || [],
    readingQueue: raw.reading_queue_suggestion_for_later_phases || [],
    weekdays: policy.regular_weekdays_iso || [2, 3, 5, 6],
    targets: policy.video_study_minutes_target || {},
    pdfExceptions: policy.extraordinary_pdf_original_schedule || {},
  };
}

// ID 기준 병합: extra 쪽 항목이 같은 ID를 덮어쓰고, 새 ID만 추가 (복사본이 생기지 않음)
export function mergeContent(base, extra) {
  if (!extra) return base;
  if (!base) return extra;
  const up = (a = [], b = [], sort) => {
    const m = new Map(a.map((x) => [x.id, x]));
    for (const x of b) m.set(x.id, x);
    const out = [...m.values()];
    return sort ? out.sort(sort) : out;
  };
  return {
    ...base,
    version: extra.version || base.version,
    generatedAt: extra.generatedAt || base.generatedAt,
    sessions: up(base.sessions, extra.sessions, bySeq),
    weeks: up(base.weeks, extra.weeks, bySeq),
    blog: up(base.blog, extra.blog, (a, b) => colOrder(a.col) - colOrder(b.col) || a.seq - b.seq),
    playlists: up(base.playlists, extra.playlists),
    readingQueue: [...new Set([...(base.readingQueue || []), ...(extra.readingQueue || [])])],
    weekdays: extra.weekdays || base.weekdays,
    targets: { ...base.targets, ...extra.targets },
    pdfExceptions: { ...base.pdfExceptions, ...extra.pdfExceptions },
  };
}
function colOrder(c) {
  const i = COLLECTIONS.findIndex((x) => x.id === c);
  return i < 0 ? 99 : i;
}

export function contentCounts(c) {
  return {
    sessions: c.sessions.length,
    items: c.sessions.reduce((t, s) => t + s.items.length, 0),
    uniqueVideos: new Set(c.sessions.flatMap((s) => s.items.map((i) => i.vid))).size,
    weeks: c.weeks.length,
    blog: c.blog.length,
    seconds: c.sessions.reduce((t, s) => t + s.items.reduce((u, i) => u + i.sec, 0), 0),
  };
}
