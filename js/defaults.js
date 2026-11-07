import { addDays } from './dates.js';

// 처음 방이 만들어질 때 쓰는 기본값. 앱 설정 화면에서 언제든 바꿀 수 있음.
export const DEFAULT_ROOM = {
  examDate: '2027-01-09',
  curriculumStart: '2026-10-26',
  chapters: [
    { no: 1, title: '소화와 흡수', pages: '', topics: [] },
    {
      no: 2,
      title: '탄수화물',
      pages: 'p.34–73',
      topics: [
        '탄수화물의 종류',
        '탄수화물의 소화와 흡수',
        '탄수화물의 기능',
        '탄수화물 대사',
        '혈당 조절',
        '탄수화물과 신체활동',
        '탄수화물 로딩',
      ],
    },
    { no: 3, title: '단백질', pages: '', topics: [] },
    { no: 4, title: '지방', pages: '', topics: [] },
    { no: 5, title: '챕터 5', pages: '', topics: [] },
    { no: 6, title: '챕터 6', pages: '', topics: [] },
    { no: 7, title: '챕터 7', pages: '', topics: [] },
    { no: 8, title: '챕터 8', pages: '', topics: [] },
    { no: 9, title: '챕터 9', pages: '', topics: [] },
  ],
};

export const TYPES = ['개념서', '문제집', '복습'];
export const PRACTICE_COUNT = 10; // 챕터당 연습문제 수
export const SCHEMA = 2;           // 2: 챕터별 시작·끝 날짜

// 날짜가 없는 챕터는 앞 챕터 다음 주(월~일)로 자동 배치
export function fillChapterDates(chapters, curriculumStart) {
  let next = curriculumStart;
  return chapters.map((c) => {
    const start = c.start || next;
    const end = c.end && c.end >= start ? c.end : addDays(start, 6);
    next = addDays(end, 1);
    return { ...c, start, end };
  });
}

// 설정 화면의 챕터 텍스트 <-> 데이터 변환
export function chaptersToText(chapters) {
  return chapters
    .map((c) => {
      const head = `${String(c.no).padStart(2, '0')} | ${c.title} | ${c.pages || ''}`.trimEnd();
      const topics = (c.topics || []).map((t) => `- ${t}`);
      return [head, ...topics].join('\n');
    })
    .join('\n\n');
}

export function textToChapters(text) {
  const out = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('-')) {
      const t = line.replace(/^-+\s*/, '').trim();
      if (t && out.length) out[out.length - 1].topics.push(t);
      continue;
    }
    const parts = line.split('|').map((s) => s.trim());
    const no = parseInt(parts[0], 10);
    if (Number.isNaN(no)) continue;
    out.push({ no, title: parts[1] || `챕터 ${no}`, pages: parts[2] || '', topics: [] });
  }
  return out;
}
