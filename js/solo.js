// ───────────────── 내 공부 (머프 강의 + 마루둥둥 교재) ─────────────────
// 화면: 오늘 · 커리큘럼(A/B/C 24주) · 교재 · 기록
// 데이터: 콘텐츠(data/moneyprinter-marupong.json + 내가 다시 가져온 파일) / 진도(Firebase users/{uid}/solo/*)
import { normalizeContent, mergeContent, contentCounts, COLLECTIONS, CONTENT_URL } from './solo-content.js';
import { settingsOf, plan, stats, weekRate, weekDaysFor, quota, isoWd, WD_KO, SPEEDS, DEFAULT_WEEKDAYS } from './solo-plan.js';
import { addDays, mondayOf, kstDateStr, dateLabel, shortDate, weekdayIdx } from './dates.js';

export function createSolo(ctx) {
  const { S, store, esc, toast, handleError, confirmBox, lockBackground, render, head, ICONS, todayKST, nowMs } = ctx;

  const ui = {
    tab: 'today',
    phase: 'A',
    sessionId: null,
    libCol: 'ALL',
    libQ: '',
    libFilter: { mark: false, unread: false, core: false },
    libOpen: null,
    weekOffset: 0,
    calMonth: null,
    calSel: null,
  };

  // ── 콘텐츠 불러오기 (앱에 들어있는 기본 파일 + 내가 가져온 파일을 ID 기준 병합) ──
  let base = null, baseErr = null, loading = false;
  async function ensureBase() {
    if (base || loading) return;
    loading = true;
    try {
      const r = await fetch(CONTENT_URL, { cache: 'no-cache' });
      base = normalizeContent(await r.json());
    } catch (e) { baseErr = e; }
    loading = false;
    render();
  }
  let memoC = { b: null, o: null, c: null };
  function content() {
    const o = S().solo?.content;
    if (!base && !o) return null;
    if (memoC.b !== base || memoC.o !== o) memoC = { b: base, o, c: mergeContent(base, o) };
    return memoC.c;
  }
  let memoP = { k: null, v: null };
  function P() {
    const c = content();
    const so = S().solo;
    const today = todayKST();
    const key = [c, so.settings, so.progress, so.blog, today];
    if (memoP.k && memoP.k.every((x, i) => x === key[i])) return memoP.v;
    const settings = settingsOf(so.settings, c);
    const p = plan(c, settings, so.progress || {}, today);
    const st = stats(c, settings, so.progress || {}, p);
    memoP = { k: key, v: { c, settings, p, st, today, prog: so.progress || {}, blog: so.blog?.a || {} } };
    return memoP.v;
  }

  // ── 저장 (입력 즉시 자동 저장; 오프라인이면 기기에 뒀다가 연결되면 올라감) ──
  const save = (name, patch) => store.soloMerge(name, patch).catch(handleError);

  // ── 공통 조각 ──
  const fmtClock = (sec) => {
    sec = Math.round(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  };
  const fmtHM = (sec) => {
    const m = Math.round(sec / 60);
    const h = Math.floor(m / 60);
    return h ? `${h}시간${m % 60 ? ` ${m % 60}분` : ''}` : `${m}분`;
  };
  const md = (d) => `${shortDate(d)}(${WD_KO[isoWd(d)]})`;
  const CHECK = '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
  const STATUS = { not_started: '예정', in_progress: '진행 중', completed: '완료', skipped: '건너뜀' };
  const sessNo = (s) => String(s.seq).padStart(2, '0');
  const colName = (id) => COLLECTIONS.find((c) => c.id === id)?.name || id;
  const taskDay = (k) => ['', '화', '수', '목', '금', '토'][Number(k)] || '';

  function phaseStrip(p) {
    const ph = p.phases;
    const seg = (key, label, sub, done, total, unlocked) => {
      const cur = ph.current === key;
      const pct = total ? Math.round((done / total) * 100) : 0;
      return `<button class="ph ${cur ? 'cur' : ''} ${done === total && total ? 'done' : ''} ${unlocked ? '' : 'locked'}" data-action="s-phase" data-phase="${key}">
        <span class="ph-k">${key}</span><b>${label}</b><small>${sub}</small>
        <span class="ph-bar"><i style="width:${pct}%"></i></span><em>${done}/${total}</em></button>`;
    };
    const wk = (phase) => {
      const ws = P().c.weeks.filter((w) => w.phase === phase);
      const done = ws.filter((w) => w.tasks.every((t) => p.byId[`${w.id}#${t.k}`]?.done)).length;
      return [done, ws.length];
    };
    const [bd, bt] = wk('B'), [cd, ct] = wk('C');
    return `<div class="ph-strip">
      ${seg('A', '영상 1회독', `${P().c.sessions.length}회차 · 약 8주`, P().st.sessionsDone + P().st.sessionsSkipped, P().st.sessionsTotal, true)}
      <span class="ph-arrow">›</span>
      ${seg('B', '블라인드 복기', '8주', bd, bt, ph.B.unlocked)}
      <span class="ph-arrow">›</span>
      ${seg('C', '모의·실행 검증', '8주', cd, ct, ph.C.unlocked)}
    </div>`;
  }

  // 같은 영상을 다른 회차에서 이미 봤는지
  function seenElsewhere(p, item) {
    for (const u of p.units) {
      if (u.type !== 'session') continue;
      for (const i of u.info.items) if (i.vid === item.vid && i.key !== item.key && i.st === 'completed') return u.s;
    }
    return null;
  }

  function videoRow(p, i, speed, locked = false) {
    const seen = seenElsewhere(p, i);
    const on = i.st === 'completed';
    return `<div class="vrow ${i.st}">
      <button class="vcheck ${on ? 'on' : ''}" data-action="s-vcheck" data-key="${esc(i.key)}" aria-label="${on ? '완료 취소' : '완료 체크'}" ${locked ? 'disabled' : ''}><span>${CHECK}</span></button>
      <div class="vbody">
        <div class="vtitle">${esc(i.title)}</div>
        <div class="vmeta"><b>${esc(i.dur)}</b>${speed !== 1 ? ` <span class="sp">→ ${fmtClock(i.sec / speed)}</span>` : ''} · ${esc(i.pl)}
          ${i.rev ? '<span class="tag">복습</span>' : ''}${i.st === 'in_progress' ? '<span class="tag prog">보는 중</span>' : ''}${seen ? `<span class="tag ok">${sessNo(seen)}회차에서 봄</span>` : ''}</div>
        <input class="vnote" data-fid="note-${esc(i.key)}" data-solo-note="assign" data-key="${esc(i.key)}" value="${esc(i.note)}" placeholder="핵심 한 줄 메모" maxlength="160" enterkeyhint="done">
      </div>
      <button class="vplay" data-action="s-open" data-key="${esc(i.key)}" aria-label="YouTube에서 열기"><svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg></button>
    </div>`;
  }

  function sessionCard(p, u, { compact = false, carry = false } = {}) {
    const { s, info } = u;
    const speed = P().settings.speed;
    const pct = info.total ? (info.doneN / info.total) * 100 : 0;
    const blogs = s.blogIds.map((id) => P().c.blog.find((b) => b.id === id)).filter(Boolean);
    return `<div class="sess-card ${info.status}">
      <div class="sess-top"><span class="sess-no">A-${sessNo(s)}</span><span class="st-chip ${info.status}">${STATUS[info.status]}</span>${carry ? '<span class="st-chip carry">이어서</span>' : ''}<span class="sess-sum">${info.doneN}/${info.total}</span></div>
      <div class="sess-title">${esc(s.title)}</div>
      <div class="sess-meta">영상 ${info.total}개 · 원본 ${fmtClock(s.sec)}${speed !== 1 ? ` · ${speed}배 ${fmtClock(s.sec / speed)}` : ''}${info.doneN && !info.done ? ` · 남은 ${fmtHM(info.remainSec / speed)}` : ''}</div>
      <div class="progress-track sess-bar"><div class="progress-fill" style="width:${pct}%;background:var(--me)"></div></div>
      ${compact ? '' : `<div class="vlist">${info.items.map((i) => videoRow(p, i, speed)).join('')}</div>
      ${blogs.length ? `<div class="rel-blog"><span>마루둥둥 함께 읽기 <small>(선택)</small></span>${blogs.map((b) => `<button class="chip-link" data-action="s-goto-blog" data-id="${esc(b.id)}">${esc(colName(b.col))} ${esc(b.num)} · ${esc(b.title)}</button>`).join('')}</div>` : ''}
      <div class="sess-actions">
        ${info.done
          ? `<button class="mini-btn" data-action="s-sess-undo" data-id="${s.id}">${info.skipped ? '건너뜀 취소 (다시 공부하기)' : '완료 되돌리기'}</button>`
          : `<button class="mini-btn" data-action="s-sess-done" data-id="${s.id}">회차 완료 처리</button>`}
        <span class="mini muted">영상을 모두 체크하면 자동 완료</span>
      </div>`}
    </div>`;
  }

  function taskCard(p, u) {
    const { w, t } = u;
    return `<div class="sess-card task ${u.done ? 'completed' : ''}">
      <div class="sess-top"><span class="sess-no">${w.phase}-${String(w.week).padStart(2, '0')}주</span><span class="st-chip ${u.done ? 'completed' : 'not_started'}">${u.done ? '완료' : '과제'}</span></div>
      <div class="sess-title">${esc(w.title)}</div>
      <div class="sess-meta">${esc(w.goal)}</div>
      <div class="task-row ${u.done ? 'on' : ''}"><button class="vcheck ${u.done ? 'on' : ''}" data-action="s-task" data-week="${w.id}" data-k="${t.k}"><span>${CHECK}</span></button><span>${esc(t.text)}</span></div>
      ${w.videos.map((v) => `<button class="chip-link" data-action="s-open-url" data-url="${esc(v.url)}" data-ios="${esc(v.ios || '')}">▶ 복습 영상 열기</button>`).join('')}
    </div>`;
  }

  const unitCard = (p, u, opt) => (u.type === 'session' ? sessionCard(p, u, opt) : taskCard(p, u));

  // ── 오늘 ──
  function weekStrip(v) {
    const { p, settings, today } = v;
    const mon = addDays(mondayOf(today), ui.weekOffset * 7);
    const days = weekDaysFor(settings, mon);
    const overridden = Array.isArray(settings.weekOverrides?.[mon]);
    let cells = '';
    for (let i = 0; i < 7; i++) {
      const d = addDays(mon, i);
      const iso = i + 1;
      const study = days.includes(iso);
      const done = (p.doneByDate[d] || []).map((id) => p.byId[id]).filter(Boolean);
      const planned = d >= today ? (p.proj[d] || []).map((id) => p.byId[id]).filter(Boolean) : [];
      const lbl = (u) => (u.type === 'session' ? `A${sessNo(u.s)}` : `${u.phase}${u.w.week}주`);
      cells += `<button class="wk-day ${study ? 'study' : 'off'} ${d === today ? 'today' : ''} ${d < today ? 'past' : ''}" data-action="s-toggle-day" data-date="${d}" aria-label="${md(d)} ${study ? '공부일' : '쉬는 날'}">
        <span class="wk-wd">${WD_KO[iso]}</span><span class="wk-dt">${Number(d.slice(8))}</span>
        <span class="wk-tags">${done.map((u) => `<i class="ok">${lbl(u)}✓</i>`).join('')}${planned.map((u) => `<i>${lbl(u)}</i>`).join('')}${!study && !done.length && !planned.length ? '<i class="rest">쉼</i>' : ''}</span>
      </button>`;
    }
    const r = weekRate(p, today);
    return `<div class="card wk-card">
      <div class="row"><span class="section-label">주간 진도</span>
        <span class="wk-nav"><button data-action="s-week" data-d="-1" aria-label="이전 주">‹</button><span>${shortDate(mon)}–${shortDate(addDays(mon, 6))}</span><button data-action="s-week" data-d="1" aria-label="다음 주">›</button></span></div>
      <div class="wk-grid">${cells}</div>
      <div class="row wk-foot"><span class="mini muted">날짜를 누르면 이 주만 공부일/쉬는 날이 바뀌어요${overridden ? ' · <button class="linkish" data-action="s-week-reset" data-mon="' + mon + '">기본 요일로</button>' : ''}</span>
        ${ui.weekOffset === 0 ? `<b class="mini">이번 주 ${Math.round(r.rate * 100)}%</b>` : ''}</div>
    </div>`;
  }

  function overview(v) {
    const { p, c } = v;
    const cell = (u) => {
      if (u.type === 'session') {
        const st = u.info.status;
        const next = p.queue[0]?.id === u.id;
        return `<button class="ov-cell ${st} ${next ? 'next' : ''}" data-action="s-open-sess" data-id="${u.id}" title="${esc(u.s.title)}">${sessNo(u.s)}</button>`;
      }
      return '';
    };
    const weekCell = (w) => {
      const done = w.tasks.every((t) => p.byId[`${w.id}#${t.k}`]?.done);
      const some = w.tasks.some((t) => p.byId[`${w.id}#${t.k}`]?.done);
      return `<button class="ov-cell wk ${done ? 'completed' : some ? 'in_progress' : 'not_started'}" data-action="s-phase" data-phase="${w.phase}">${w.week}</button>`;
    };
    return `<div class="card ov-card">
      <div class="row"><span class="section-label">전체 커리큘럼</span><button class="linkish mini" data-action="s-go" data-tab="curri">자세히</button></div>
      <div class="ov-lbl">A · 영상 1회독 33회차</div>
      <div class="ov-grid">${p.units.filter((u) => u.type === 'session').map(cell).join('')}</div>
      <div class="ov-lbl">B · 블라인드 복기 8주 <span>C · 모의·실행 검증 8주</span></div>
      <div class="ov-grid two">${c.weeks.filter((w) => w.phase === 'B').map(weekCell).join('')}<span class="ov-gap"></span>${c.weeks.filter((w) => w.phase === 'C').map(weekCell).join('')}</div>
      <div class="ov-legend"><i class="completed"></i>완료 <i class="in_progress"></i>진행 중 <i class="skipped"></i>건너뜀 <i class="next"></i>다음</div>
    </div>`;
  }

  function onboarding(v) {
    const opts = v.c.sessions.map((s) => `<option value="${s.seq}">${sessNo(s)}회차 · ${esc(s.title)}</option>`).join('');
    return `<div class="card onb">
      <b class="onb-t">어디서부터 시작할까요?</b>
      <p>PDF에 적힌 옛 날짜와 상관없이, 실제로 이어서 들을 회차를 직접 골라요. 오늘 날짜로 회차를 계산하거나 자동으로 완료 처리하지 않아요.</p>
      <select class="field" id="onb-seq">${opts}</select>
      <p class="mini muted">고른 회차 앞부분은 '건너뜀'으로만 표시되고 시청 시간에는 넣지 않아요. 설정에서 언제든 바꿀 수 있어요.</p>
      <button class="btn-block" data-action="s-start">이 회차부터 시작</button>
    </div>`;
  }

  function renderToday() {
    const v = P();
    const { p, settings, today, c, st } = v;
    if (!settings.start) {
      return `${head('MY STUDY', '내 공부<span class="dot-end">.</span>')}${onboarding(v)}`;
    }
    const iso = isoWd(today);
    const tg = c.targets?.[String(iso)];
    const studyToday = quota(settings, today) > 0;
    const speed = settings.speed;
    const todayUnits = [...p.doneToday, ...p.todayNext];
    const remainSec = p.todayNext.filter((u) => u.type === 'session').reduce((t, u) => t + u.info.remainSec, 0);
    const allSec = todayUnits.filter((u) => u.type === 'session').reduce((t, u) => t + u.s.sec, 0);
    const lastDone = p.units.filter((u) => u.done && !u.skipped && u.doneAt).sort((a, b) => b.doneAt - a.doneAt)[0];
    // 이어서: 오늘 전에 시작했는데 아직 못 끝낸 회차
    const carry = (u) => u.type === 'session' && !u.done && u.info.items.some((i) => i.at && kstDateStr(i.at) < today);

    let todayBody = '';
    if (!p.queue.length) todayBody = '<div class="done-banner">🎉 24주 과정을 모두 마쳤어요</div>';
    else if (!todayUnits.length) {
      const nx = p.queue[0];
      todayBody = `<div class="rest-day"><b>오늘은 쉬는 날이에요</b>
        <span>다음 공부일 ${p.nextStudyDate ? md(p.nextStudyDate) : '–'} · ${nx.type === 'session' ? `A-${sessNo(nx.s)} ${esc(nx.s.title)}` : esc(nx.w.title)}</span>
        <button class="btn-line" data-action="s-pull">그래도 오늘 하기</button></div>`;
    } else {
      todayBody = todayUnits.map((u) => unitCard(p, u, { carry: carry(u) })).join('');
      if (!p.todayNext.length && p.nextAfterToday) {
        const nx = p.nextAfterToday;
        todayBody += `<div class="done-banner">오늘 분량 끝! 👏<span>다음은 ${p.nextStudyDate ? md(p.nextStudyDate) : '다음 공부일'} · ${nx.type === 'session' ? `A-${sessNo(nx.s)}` : esc(nx.w.title)}</span>
          <button class="btn-line" data-action="s-pull">다음 회차 미리 하기</button></div>`;
      }
    }

    const todayCard = `<div class="card today-card">
      <div class="row"><div><div class="today-date">${dateLabel(today)}</div>
        <div class="mini muted">${studyToday ? `공부일 · 분량 ${quota(settings, today)}회차${tg ? ` · 목표 ${tg[0]}–${tg[1]}분` : ''}` : '쉬는 날'}</div></div>
        <div class="speed">${SPEEDS.map((x) => `<button class="${x === speed ? 'on' : ''}" data-action="s-speed" data-v="${x}">${x}×</button>`).join('')}</div></div>
      ${todayUnits.length ? `<div class="today-sum"><span>오늘 영상 <b>${fmtClock(allSec)}</b>${speed !== 1 ? ` <small>(${speed}배 ${fmtClock(allSec / speed)})</small>` : ''}</span><span>남은 <b>${fmtHM(remainSec / speed)}</b></span></div>` : ''}
      ${lastDone ? `<div class="mini muted last-done">마지막 완료: ${lastDone.type === 'session' ? `A-${sessNo(lastDone.s)} ${esc(lastDone.s.title)}` : esc(lastDone.w.title)} · ${md(kstDateStr(lastDone.doneAt))}</div>` : ''}
    </div>`;

    const tiles = `<div class="solo-tiles">
      <div><span>회차</span><b>${st.sessionsDone}<small>/${st.sessionsTotal}</small></b></div>
      <div><span>영상</span><b>${st.videosDone}<small>/${st.videosTotal}</small></b></div>
      <div><span>누적 시청</span><b>${fmtHM(st.watchedSec)}</b></div>
      <div><span>교재</span><b>${Object.values(v.blog).filter((b) => b.read).length}<small>/${c.blog.length}</small></b></div>
    </div>`;

    return `${head('MY STUDY', '내 공부<span class="dot-end">.</span>')}
      ${phaseStrip(p)}
      <div class="solo-cols">
        <div class="solo-main">${todayCard}<div class="today-units">${todayBody}</div></div>
        <div class="solo-side">${weekStrip(v)}${overview(v)}${tiles}</div>
      </div>`;
  }

  // ── 커리큘럼 ──
  function renderCurri() {
    const v = P();
    const { p, c } = v;
    if (ui.sessionId) {
      const u = p.byId[ui.sessionId];
      if (u) {
        const s = u.s;
        return `<div class="solo-top"><button class="back-btn" data-action="s-back">‹ 커리큘럼</button></div>
          ${sessionCard(p, u, { carry: u.info.status === 'in_progress' })}
          <div class="card note-card"><label class="mini strong">회차 메모</label>
            <textarea class="field" rows="3" data-fid="snote-${s.id}" data-solo-note="session" data-id="${s.id}" placeholder="이 회차에서 배운 것, 다시 볼 부분">${esc(u.info.note)}</textarea></div>
          <div class="hint-row">원 PDF 편성: ${s.pdfDate ? `${s.pdfDate}(${esc(s.pdfWd)})` : '–'} · 참고용 날짜예요 (실제 일정은 진도 순서대로)</div>`;
      }
      ui.sessionId = null;
    }
    const tabs = `<div class="booktabs">${[['A', 'A 영상 1회독'], ['B', 'B 블라인드 복기'], ['C', 'C 모의·실행']].map(([k, l]) => `<button class="${ui.phase === k ? 'active' : ''}" data-action="s-phase" data-phase="${k}">${l}</button>`).join('')}</div>`;
    let body = '';
    if (ui.phase === 'A') {
      body = `<div class="qlist">${p.units.filter((u) => u.type === 'session').map((u) => {
        const s = u.s, i = u.info;
        const when = i.done ? (i.skipped ? '건너뜀' : `완료 ${md(kstDateStr(i.doneAt))}`) : p.plannedDate[u.id] ? `예정 ${md(p.plannedDate[u.id])}` : '';
        return `<button class="qrow sess-row ${i.status} ${p.queue[0]?.id === u.id ? 'next' : ''}" data-action="s-open-sess" data-id="${u.id}">
          <span class="qno">${sessNo(s)}</span>
          <span class="qtext"><b>${esc(s.title)}</b><small>영상 ${i.total} · ${fmtClock(s.sec)}${when ? ` · ${when}` : ''}</small></span>
          <span class="qstat ${i.status === 'completed' ? 'ok' : i.status === 'in_progress' ? 'todo' : i.status === 'skipped' ? 'skip' : 'plain'}">${i.status === 'in_progress' ? `${i.doneN}/${i.total}` : STATUS[i.status]}</span></button>`;
      }).join('')}</div>`;
    } else {
      const ph = ui.phase;
      const unlocked = p.phases[ph].unlocked;
      const desc = ph === 'B'
        ? '오른쪽을 가린 차트로 리플레이 → 진입 전에 조건·무효화·손절을 먼저 적고, 반례까지 기록해요.'
        : '계획 준수율·손절 실행률을 우선 보고, 추격·물타기·복수매매 오류를 점검해요. 소액 실전은 자동으로 권하거나 시작하지 않아요 — 검증 기준을 충족했을 때 직접 선택해요.';
      body = `<div class="phase-desc">${desc}${unlocked ? '' : `<b>🔒 ${ph === 'B' ? 'A 영상 1회독' : 'B 블라인드 복기'}을 다 끝내면 열려요 (미리 보기만 가능)</b>`}</div>
        ${c.weeks.filter((w) => w.phase === ph).map((w) => {
          const done = w.tasks.filter((t) => p.byId[`${w.id}#${t.k}`]?.done).length;
          const wp = v.prog.week?.[w.id] || {};
          return `<div class="card week-card ${done === w.tasks.length ? 'completed' : ''}">
            <div class="row"><span class="sess-no">${ph}-${String(w.week).padStart(2, '0')}주</span><span class="mini muted">${done}/${w.tasks.length}</span></div>
            <div class="sess-title">${esc(w.title)}</div>
            <div class="sess-meta">${esc(w.goal)}</div>
            ${w.tasks.map((t) => {
              const on = !!p.byId[`${w.id}#${t.k}`]?.done;
              return `<div class="task-row ${on ? 'on' : ''}"><button class="vcheck ${on ? 'on' : ''}" data-action="s-task" data-week="${w.id}" data-k="${t.k}" ${unlocked ? '' : 'disabled'}><span>${CHECK}</span></button><span><small>기준 ${taskDay(t.k)}</small>${esc(t.text)}</span></div>`;
            }).join('')}
            ${w.videos.map((vv) => `<button class="chip-link" data-action="s-open-url" data-url="${esc(vv.url)}" data-ios="${esc(vv.ios || '')}">▶ 복습 영상 열기</button>`).join('')}
            <input class="vnote" data-fid="wnote-${w.id}" data-solo-note="week" data-id="${w.id}" value="${esc(wp.note || '')}" placeholder="이번 주 기록 한 줄" maxlength="200">
          </div>`;
        }).join('')}`;
    }
    return `${head('CURRICULUM', '전체 커리큘럼')}${phaseStrip(p)}${tabs}${body}`;
  }

  // ── 교재 (마루둥둥) ──
  function libList(v) {
    const { c } = v;
    const q = ui.libQ.trim().toLowerCase();
    const related = relatedSessions(c);
    const list = c.blog.filter((b) => {
      const st = v.blog[b.id] || {};
      if (ui.libCol !== 'ALL' && b.col !== ui.libCol) return false;
      if (ui.libFilter.mark && !st.mark) return false;
      if (ui.libFilter.unread && st.read) return false;
      if (ui.libFilter.core && b.pri !== 'core') return false;
      if (q && !(`${b.title} ${colName(b.col)} ${b.num} ${st.note || ''}`.toLowerCase().includes(q))) return false;
      return true;
    });
    if (!list.length) return '<div class="card empty-note" style="margin-top:12px">조건에 맞는 글이 없어요.</div>';
    return list.map((b) => {
      const st = v.blog[b.id] || {};
      const open = ui.libOpen === b.id;
      const rel = related[b.id] || [];
      return `<div class="lib-item ${st.read ? 'read' : ''} ${open ? 'open' : ''}">
        <div class="lib-row">
          <button class="vcheck ${st.read ? 'on' : ''}" data-action="b-read" data-id="${esc(b.id)}" aria-label="읽음 표시"><span>${CHECK}</span></button>
          <button class="lib-body" data-action="b-toggle" data-id="${esc(b.id)}">
            <span class="lib-top"><span class="lib-col">${esc(colName(b.col))} ${esc(b.num)}</span>${b.pri === 'core' ? '<span class="tag core">핵심</span>' : ''}${b.url ? '' : '<span class="tag warn">링크 미확인</span>'}${rel.length ? `<span class="tag">머프 ${rel.length}</span>` : ''}</span>
            <span class="lib-title">${esc(b.title)}</span>
            ${st.note && !open ? `<span class="lib-note">📝 ${esc(st.note)}</span>` : ''}
          </button>
          <button class="star ${st.mark ? 'on' : ''}" data-action="b-mark" data-id="${esc(b.id)}" aria-label="북마크">★</button>
        </div>
        ${open ? `<div class="lib-detail">
          ${b.url
            ? `<a class="btn-line lib-link" href="${esc(b.url)}" target="_blank" rel="noopener" data-action="b-opened" data-id="${esc(b.id)}">원문 열기 ↗</a>`
            : `<a class="btn-line lib-link" href="${esc(b.idx)}" target="_blank" rel="noopener" data-action="b-opened" data-id="${esc(b.id)}">글 목록에서 찾기 ↗</a><span class="mini muted">개별 글 주소가 확인되지 않아 블로그의 글 목록으로 연결해요.</span>`}
          <input class="vnote" data-fid="bnote-${esc(b.id)}" data-solo-note="blog" data-id="${esc(b.id)}" value="${esc(st.note || '')}" placeholder="한 줄 메모" maxlength="200">
          ${rel.length ? `<div class="rel-blog"><span>관련 머프 강의</span>${rel.map((s) => `<button class="chip-link" data-action="s-open-sess" data-id="${s.id}">A-${sessNo(s)} ${esc(s.title)}</button>`).join('')}</div>` : ''}
          <div class="mini muted">출처: ${esc(b.origin || '마루둥둥 블로그')}${st.read ? ` · 읽음 ${md(kstDateStr(st.read))}` : ''}</div>
        </div>` : ''}
      </div>`;
    }).join('');
  }
  let relMemo = { c: null, v: null };
  function relatedSessions(c) {
    if (relMemo.c === c) return relMemo.v;
    const m = {};
    for (const s of c.sessions) for (const id of s.blogIds) (m[id] ||= []).push(s);
    relMemo = { c, v: m };
    return m;
  }
  function renderLibrary() {
    const v = P();
    const { c } = v;
    const cnt = (id) => c.blog.filter((b) => id === 'ALL' || b.col === id).length;
    const readCnt = Object.values(v.blog).filter((b) => b.read).length;
    return `${head('MARUPONG', '마루둥둥 교재')}
      <div class="lib-head"><span>읽음 <b>${readCnt}</b>/${c.blog.length} · 북마크 <b>${Object.values(v.blog).filter((b) => b.mark).length}</b></span><span class="mini muted">영상과 별도 자료실 · 필수 아님</span></div>
      <input class="field lib-search" id="lib-search" data-fid="lib-search" type="search" placeholder="제목·번호·메모 검색" value="${esc(ui.libQ)}" enterkeyhint="search">
      <div class="week-scroll lib-cols">${[{ id: 'ALL', name: '전체' }, ...COLLECTIONS].map((x) => `<button class="filter-chip ${ui.libCol === x.id ? 'on' : ''}" data-action="b-col" data-col="${x.id}">${x.name} ${cnt(x.id)}</button>`).join('')}</div>
      <div class="lib-filters">${[['mark', '★ 북마크'], ['unread', '안 읽음'], ['core', '핵심만']].map(([k, l]) => `<button class="filter-chip ${ui.libFilter[k] ? 'on' : ''}" data-action="b-filter" data-k="${k}">${l}</button>`).join('')}</div>
      <div id="lib-list">${libList(v)}</div>
      <div class="hint-row">마루둥둥(둥둥마루) 블로그에 번역·정리된 외부 저자 자료예요. 머프 강의와 저자가 달라요.<br>원문은 블로그에서 읽고, 여기서는 읽음·북마크·메모만 관리해요.</div>`;
  }

  // ── 기록 ──
  function renderRecord() {
    const v = P();
    const { p, st, today, c } = v;
    if (!ui.calMonth) ui.calMonth = today.slice(0, 7);
    if (!ui.calSel) ui.calSel = today;
    const [y, m] = ui.calMonth.split('-').map(Number);
    const first = `${ui.calMonth}-01`;
    const last = `${ui.calMonth}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
    const g0 = mondayOf(first), g1 = addDays(mondayOf(last), 6);
    const blogBy = {};
    for (const [id, b] of Object.entries(v.blog)) if (b.read) (blogBy[kstDateStr(b.read)] ||= []).push(id);
    const vidBy = {};
    for (const u of p.units) if (u.type === 'session') for (const i of u.info.items) if (i.st === 'completed' && i.at) (vidBy[kstDateStr(i.at)] ||= []).push(i);
    let cells = '';
    for (let d = g0; d <= g1; d = addDays(d, 1)) {
      const units = (p.doneByDate[d] || []).map((id) => p.byId[id]);
      const nv = (vidBy[d] || []).length, nb = (blogBy[d] || []).length;
      const tags = [
        ...units.slice(0, 2).map((u) => `<span class="cal-tag"><span class="cal-chno">${u.type === 'session' ? `A${sessNo(u.s)}` : `${u.phase}${u.w.week}주`}</span></span>`),
        nv && !units.length ? `<span class="cal-tag"><span class="cal-chno">영상 ${nv}</span></span>` : '',
        nb ? `<span class="cal-tag blog"><span class="cal-chno">글 ${nb}</span></span>` : '',
      ].join('');
      cells += `<button class="cal-cell ${d.slice(0, 7) === ui.calMonth ? '' : 'out'} ${d === today ? 'today' : ''} ${d === ui.calSel ? 'sel' : ''} ${weekdayIdx(d) >= 5 ? 'wkend' : ''}" data-action="s-cal-day" data-date="${d}"><span class="cal-num">${Number(d.slice(8))}</span>${tags}</button>`;
    }
    const sel = ui.calSel;
    const selUnits = (p.doneByDate[sel] || []).map((id) => p.byId[id]);
    const selVids = vidBy[sel] || [];
    const selBlogs = (blogBy[sel] || []).map((id) => c.blog.find((b) => b.id === id)).filter(Boolean);
    const detail = [
      ...selUnits.map((u) => `<div class="recent-item"><span class="dot me"></span><div class="grow"><b>${u.type === 'session' ? `A-${sessNo(u.s)} ${esc(u.s.title)}` : `${u.phase}-${u.w.week}주 · ${esc(u.t.text)}`}</b><div class="mini muted">${u.type === 'session' ? '회차 완료' : '과제 완료'}</div></div></div>`),
      selVids.length ? `<div class="recent-item"><span class="dot me"></span><div class="grow"><b>영상 ${selVids.length}개 체크</b><div class="mini muted">${fmtHM(selVids.reduce((t, i) => t + i.sec, 0))} (원본)</div></div></div>` : '',
      ...selBlogs.map((b) => `<div class="recent-item"><span class="dot fr"></span><div class="grow"><b>${esc(colName(b.col))} ${esc(b.num)} · ${esc(b.title)}</b><div class="mini muted">교재 읽음</div></div></div>`),
    ].join('');
    const r = weekRate(p, today);
    return `${head('MY RECORD', '내 기록')}
      <div class="solo-tiles four">
        <div><span>회차 완료</span><b>${st.sessionsDone}<small>/${st.sessionsTotal}</small></b>${st.sessionsSkipped ? `<em>건너뜀 ${st.sessionsSkipped}</em>` : ''}</div>
        <div><span>영상</span><b>${st.videosDone}<small>/${st.videosTotal}</small></b></div>
        <div><span>누적 시청</span><b>${fmtHM(st.watchedSec)}</b><em>원본 기준</em></div>
        <div><span>교재 읽음</span><b>${Object.values(v.blog).filter((b) => b.read).length}<small>/${c.blog.length}</small></b></div>
        <div><span>이번 주</span><b>${Math.round(r.rate * 100)}<small>%</small></b><em>${r.done}개 완료 · 남은 ${r.planned}</em></div>
        <div><span>B·C 과제</span><b>${p.units.filter((u) => u.type === 'task' && u.done).length}<small>/${p.units.filter((u) => u.type === 'task').length}</small></b></div>
      </div>
      <div class="recordcard cal-card" style="margin-top:14px">
        <div class="row cal-nav"><button class="cal-arrow" data-action="s-cal-move" data-d="-1">‹</button><span class="strong" style="font-size:16px">${y}년 ${m}월</span><button class="cal-arrow" data-action="s-cal-move" data-d="1">›</button></div>
        <div class="cal-grid cal-head">${['월', '화', '수', '목', '금', '토', '일'].map((w) => `<span>${w}</span>`).join('')}</div>
        <div class="cal-grid">${cells}</div>
      </div>
      <div class="row" style="margin-top:18px"><span class="section-label">${dateLabel(sel)}</span></div>
      <div class="recent">${detail || '<div class="empty-note" style="padding:14px 0">이날은 기록이 없어요.</div>'}</div>`;
  }

  // ── 전체 렌더 ──
  function renderBody() {
    const so = S().solo;
    if (so?.error === 'permission-denied') {
      return `${head('MY STUDY', '내 공부<span class="dot-end">.</span>')}<div class="card empty-note">내 공부를 쓰려면 Firestore 규칙에 <b>내 공부 칸</b>을 추가해서 다시 게시해야 해요. (설정 안내 참고)</div>`;
    }
    if (!base) ensureBase();
    if (baseErr && !content()) return `${head('MY STUDY', '내 공부')}<div class="card empty-note">커리큘럼 파일을 불러오지 못했어요. 인터넷 연결 후 다시 열어 주세요.</div>`;
    if (!content() || !so?.loaded) return `${head('MY STUDY', '내 공부')}<div class="boot" style="min-height:40vh">불러오는 중…</div>`;
    if (ui.tab === 'curri') return renderCurri();
    if (ui.tab === 'library') return renderLibrary();
    if (ui.tab === 'record') return renderRecord();
    return renderToday();
  }

  const NAV_ICONS = {
    today: '<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="16" rx="3"/><path d="M3.5 9.5h17M8 2.8v3.4M16 2.8v3.4M8.5 14.5l2.3 2.3 4.7-4.7"/></svg>',
    curri: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/><circle cx="19" cy="18" r="1.6"/></svg>',
    library: '<svg viewBox="0 0 24 24"><path d="M5 4.5h9a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/><path d="M17 7.5h2V20M8.5 9h5M8.5 12.5h5"/></svg>',
    record: ICONS.stats,
  };
  function navHTML() {
    return [['today', '오늘'], ['curri', '커리큘럼'], ['library', '교재'], ['record', '기록']]
      .map(([k, l]) => `<button class="${ui.tab === k ? 'active' : ''}" data-action="s-go" data-tab="${k}"><span>${NAV_ICONS[k]}</span><span>${l}</span></button>`).join('');
  }

  // ── 영상 열기: iOS는 YouTube 앱 주소를 먼저 시도하고, 안 열리면 웹 주소로 (항상 앱으로 열린다는 보장은 없음) ──
  function openYouTube(url, ios) {
    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isIOS && ios) {
      let left = false;
      const onHide = () => { if (document.visibilityState === 'hidden') left = true; };
      document.addEventListener('visibilitychange', onHide);
      window.location.href = ios;
      setTimeout(() => {
        document.removeEventListener('visibilitychange', onHide);
        if (!left && document.visibilityState === 'visible') window.location.href = url;
      }, 1500);
    } else {
      // 'noopener' 옵션을 주면 항상 null이 돌아와서 앱 화면이 넘어가 버리므로 열고 나서 끊음
      const w = window.open(url, '_blank');
      if (w) { try { w.opener = null; } catch (e) {} } else window.location.href = url; // 팝업이 막힌 경우만
    }
  }

  function findItem(key) {
    for (const u of P().p.units) if (u.type === 'session') for (const i of u.info.items) if (i.key === key) return { u, i };
    return null;
  }

  // ── 동작 ──
  async function handle(act, el) {
    const v = P();
    const now = nowMs();
    switch (act) {
      case 's-go':
        ui.tab = el.dataset.tab; ui.sessionId = null; ctx.navigated(); return true;
      case 's-phase':
        ui.tab = 'curri'; ui.phase = el.dataset.phase; ui.sessionId = null; ctx.navigated(); return true;
      case 's-open-sess':
        ui.tab = 'curri'; ui.phase = 'A'; ui.sessionId = el.dataset.id; ctx.navigated(); return true;
      case 's-back':
        ui.sessionId = null; ctx.navigated(); return true;
      case 's-goto-blog': {
        const b = v.c.blog.find((x) => x.id === el.dataset.id);
        ui.tab = 'library'; ui.libCol = 'ALL'; ui.libQ = ''; ui.libFilter = { mark: false, unread: false, core: false }; ui.libOpen = el.dataset.id;
        ctx.navigated();
        requestAnimationFrame(() => document.querySelector('.lib-item.open')?.scrollIntoView({ block: 'center' }));
        return !!b;
      }
      case 's-start': {
        const seq = Number(document.getElementById('onb-seq')?.value || 1);
        await save('settings', { start: { seq, at: now }, weekdays: v.settings.weekdays || DEFAULT_WEEKDAYS });
        toast(`${String(seq).padStart(2, '0')}회차부터 시작해요`);
        return true;
      }
      case 's-vcheck': {
        const f = findItem(el.dataset.key);
        if (!f) return true;
        const on = f.i.st === 'completed';
        const patch = { assign: { [f.i.key]: { st: on ? 'not_started' : 'completed', at: on ? 0 : now } } };
        // 마지막 영상까지 체크하면 수동 '되돌리기'를 풀고 자동 완료
        if (!on && f.u.info.items.every((i) => i.key === f.i.key || i.st === 'completed')) patch.session = { [f.u.s.id]: { manual: null } };
        el.classList.toggle('on', !on);
        await save('progress', patch);
        if (!on && patch.session) toast(`A-${sessNo(f.u.s)} 회차 완료! 👏`);
        return true;
      }
      case 's-open': {
        const f = findItem(el.dataset.key);
        if (!f) return true;
        if (f.i.st === 'not_started') save('progress', { assign: { [f.i.key]: { st: 'in_progress', at: now } } });
        openYouTube(f.i.url, f.i.ios);
        return true;
      }
      case 's-open-url':
        openYouTube(el.dataset.url, el.dataset.ios || null);
        return true;
      case 's-sess-done':
        await save('progress', { session: { [el.dataset.id]: { manual: 'done', at: now } } });
        return true;
      case 's-sess-undo': {
        const ok = await confirmBox('완료를 되돌릴까요?', '이 회차가 다시 해야 할 목록으로 돌아와요. 체크한 영상과 메모는 그대로예요.', '되돌리기');
        if (ok) await save('progress', { session: { [el.dataset.id]: { manual: 'undone', at: now } } });
        return true;
      }
      case 's-task': {
        const wid = el.dataset.week, k = el.dataset.k;
        const on = !!v.prog.week?.[wid]?.tasks?.[k];
        el.classList.toggle('on', !on);
        await save('progress', { week: { [wid]: { tasks: { [k]: on ? 0 : now } } } });
        return true;
      }
      case 's-speed':
        await save('settings', { speed: Number(el.dataset.v) });
        return true;
      case 's-pull': {
        const t = v.today;
        await save('settings', { extra: { [t]: (v.settings.extra?.[t] || 0) + 1 } });
        return true;
      }
      case 's-week':
        ui.weekOffset += Number(el.dataset.d); render(); return true;
      case 's-toggle-day': {
        const d = el.dataset.date;
        const mon = mondayOf(d);
        const cur = [...weekDaysFor(v.settings, d)];
        const iso = isoWd(d);
        const next = cur.includes(iso) ? cur.filter((x) => x !== iso) : [...cur, iso].sort((a, b) => a - b);
        await save('settings', { weekOverrides: { [mon]: next } });
        toast(`${md(d)} ${next.includes(iso) ? '공부일로' : '쉬는 날로'} 바꿨어요 · 이 주만`);
        return true;
      }
      case 's-week-reset':
        await save('settings', { weekOverrides: { [el.dataset.mon]: null } });
        return true;
      case 's-cal-day':
        ui.calSel = el.dataset.date;
        if (ui.calSel.slice(0, 7) !== ui.calMonth) ui.calMonth = ui.calSel.slice(0, 7);
        render(); return true;
      case 's-cal-move': {
        const [yy, mm] = ui.calMonth.split('-').map(Number);
        ui.calMonth = new Date(Date.UTC(yy, mm - 1 + Number(el.dataset.d), 1)).toISOString().slice(0, 7);
        render(); return true;
      }
      case 'b-col':
        ui.libCol = el.dataset.col; render(); return true;
      case 'b-filter':
        ui.libFilter[el.dataset.k] = !ui.libFilter[el.dataset.k]; render(); return true;
      case 'b-toggle':
        ui.libOpen = ui.libOpen === el.dataset.id ? null : el.dataset.id; render(); return true;
      case 'b-read': {
        const id = el.dataset.id;
        const on = !!v.blog[id]?.read;
        el.classList.toggle('on', !on);
        await save('blog', { a: { [id]: { read: on ? 0 : now } } });
        return true;
      }
      case 'b-mark': {
        const id = el.dataset.id;
        await save('blog', { a: { [id]: { mark: !v.blog[id]?.mark } } });
        return true;
      }
      case 'b-opened':
        save('blog', { a: { [el.dataset.id]: { opened: now } } });
        return 'passthrough'; // 링크는 그대로 열리게
    }
    return false;
  }

  // 메모 입력: 칸을 벗어나거나 완료를 누르면 저장
  function onChange(e) {
    const t = e.target;
    const kind = t.dataset?.soloNote;
    if (!kind) return false;
    const val = t.value.trim();
    if (kind === 'assign') save('progress', { assign: { [t.dataset.key]: { note: val } } });
    else if (kind === 'session') save('progress', { session: { [t.dataset.id]: { note: val } } });
    else if (kind === 'week') save('progress', { week: { [t.dataset.id]: { note: val } } });
    else if (kind === 'blog') save('blog', { a: { [t.dataset.id]: { note: val } } });
    t.classList.add('saved');
    setTimeout(() => t.classList.remove('saved'), 900);
    return true;
  }
  function onInput(e) {
    if (e.target.id !== 'lib-search') return false;
    ui.libQ = e.target.value;
    const box = document.getElementById('lib-list');
    if (box) box.innerHTML = libList(P());
    return true;
  }
  function onKey(e) {
    if (e.key === 'Enter' && e.target.dataset?.soloNote && e.target.tagName === 'INPUT') e.target.blur();
  }

  // ── 설정 시트 ──
  function openSettings() {
    const v = P();
    const c = v.c;
    const counts = contentCounts(c);
    const wrap = document.createElement('div');
    wrap.className = 'sheet-back';
    const draw = () => {
      const s = settingsOf(S().solo.settings, c);
      return `<div class="sheet" role="dialog" aria-label="내 공부 설정">
        <div class="sheet-head"><div class="grab"></div><h2>내 공부 설정</h2></div>
        <div class="sheet-body">
          <label>공부 요일 <span class="muted" style="font-weight:600">(기본 · 매주 반복)</span></label>
          <div class="wd-pick">${[1, 2, 3, 4, 5, 6, 7].map((d) => `<button class="${s.weekdays.includes(d) ? 'on' : ''}" data-set="wd" data-v="${d}">${WD_KO[d]}</button>`).join('')}</div>
          <div class="hint">근무 때문에 이번 주만 바꾸려면 <b>오늘 탭 → 주간 진도</b>에서 날짜를 눌러요.</div>
          <label>요일별 분량 <span class="muted" style="font-weight:600">(공부일 하루에 할 회차 수)</span></label>
          ${s.weekdays.map((d) => {
            const tg = c.targets?.[String(d)];
            return `<div class="qty-row"><span>${WD_KO[d]}요일${tg ? ` <small>목표 ${tg[0]}–${tg[1]}분</small>` : ''}</span>
              <span class="stepper"><button data-set="qty" data-d="${d}" data-v="-1" aria-label="줄이기">−</button><b>${s.perDay[d] ?? 1}회차</b><button data-set="qty" data-d="${d}" data-v="1" aria-label="늘리기">+</button></span></div>`;
          }).join('')}
          <div class="hint">회차마다 영상 길이가 달라요(약 1시간 25분~4시간). 못 끝낸 회차는 다음 공부일로 그대로 넘어가요.</div>
          <label>재생 속도 <span class="muted" style="font-weight:600">(예상 시간만 다시 계산 · 원본 시간은 그대로)</span></label>
          <div class="speed wide">${SPEEDS.map((x) => `<button class="${x === s.speed ? 'on' : ''}" data-set="speed" data-v="${x}">${x}×</button>`).join('')}</div>
          <label>시작 회차</label>
          <div class="start-row"><select class="field" id="set-start">${c.sessions.map((x) => `<option value="${x.seq}" ${s.start?.seq === x.seq ? 'selected' : ''}>${sessNo(x)}회차 · ${esc(x.title)}</option>`).join('')}</select><button class="btn-line" data-set="start">적용</button></div>
          <div class="hint">앞 회차는 '건너뜀'으로만 표시돼요(시청 시간에는 안 들어감). 이미 체크한 영상·메모는 그대로 남아요.</div>
          <label>커리큘럼 데이터</label>
          <div class="data-box"><b>머프 ${counts.sessions}회차 · 영상 배정 ${counts.items}건(고유 ${counts.uniqueVideos}개) · B/C ${counts.weeks}주 · 마루둥둥 ${counts.blog}편</b>
            <span>원본 영상 ${fmtClock(counts.seconds)}</span>
            <button class="btn-line" data-set="import">⬆ JSON 다시 가져오기</button>
            <input type="file" id="solo-import" accept=".json,application/json" hidden>
            <span class="hint">같은 파일을 몇 번 가져와도 ID 기준으로 합쳐서 중복이 생기지 않고, 진도·메모는 그대로예요.</span></div>
          ${ctx.backupHTML()}
          <label>스킨 색상 <span class="muted" style="font-weight:600">(이 기기에만 적용)</span></label>
          ${ctx.skinHTML()}
          <div class="hint save-scope">📦 저장 위치: 체크·메모·설정은 입력하는 순간 Firebase의 <b>내 계정 전용 칸</b>에 자동 저장돼요. 같은 계정으로 로그인한 폰·아이패드에 똑같이 보이고, 새로고침하거나 앱을 다시 열어도 남아 있어요. 인터넷이 끊기면 기기에 먼저 저장했다가 연결되면 올라가요. 가영 계정에서는 볼 수 없어요.</div>
        </div>
        <div class="sheet-foot"><button class="btn-block" data-set="close">닫기</button></div>
      </div>`;
    };
    wrap.innerHTML = draw();
    document.body.appendChild(wrap);
    const unlock = lockBackground(wrap);
    requestAnimationFrame(() => wrap.classList.add('open'));
    const close = () => { wrap.classList.remove('open'); setTimeout(() => { wrap.remove(); unlock(); }, 260); };
    const redraw = () => {
      const y = wrap.querySelector('.sheet-body')?.scrollTop || 0;
      wrap.innerHTML = draw();
      wrap.classList.add('open');
      wrap.querySelector('.sheet').style.transition = 'none';
      wrap.querySelector('.sheet-body').scrollTop = y;
      bind();
    };
    const bind = () => {
      ctx.bindBackup(wrap);
      ctx.bindSkin(wrap);
      const $f = wrap.querySelector('#solo-import');
      $f.onchange = async () => {
        const f = $f.files?.[0]; $f.value = '';
        if (f) await importContentFile(f);
        redraw();
      };
    };
    bind();
    wrap.addEventListener('click', async (e) => {
      if (e.target === wrap) return close();
      const b = e.target.closest('[data-set]');
      if (!b) return;
      const s = settingsOf(S().solo.settings, c);
      try {
        switch (b.dataset.set) {
          case 'close': return close();
          case 'wd': {
            const d = Number(b.dataset.v);
            const next = s.weekdays.includes(d) ? s.weekdays.filter((x) => x !== d) : [...s.weekdays, d].sort((a, b2) => a - b2);
            await save('settings', { weekdays: next });
            break;
          }
          case 'qty': {
            const d = b.dataset.d;
            const n = Math.max(0, Math.min(4, (s.perDay[d] ?? 1) + Number(b.dataset.v)));
            await save('settings', { perDay: { [d]: n } });
            break;
          }
          case 'speed':
            await save('settings', { speed: Number(b.dataset.v) });
            break;
          case 'start': {
            const seq = Number(wrap.querySelector('#set-start').value);
            if (await confirmBox(`${String(seq).padStart(2, '0')}회차부터 시작할까요?`, '앞 회차는 건너뜀으로 표시돼요. 체크한 기록은 지워지지 않아요.', '적용')) {
              await save('settings', { start: { seq, at: nowMs() } });
              toast('시작 회차를 바꿨어요');
            }
            break;
          }
          case 'import':
            wrap.querySelector('#solo-import').click();
            return;
        }
        redraw();
      } catch (err) { handleError(err); }
    });
  }

  // 콘텐츠 파일 다시 가져오기 → ID 기준 병합해서 저장 (진도는 손대지 않음)
  async function importContentFile(file) {
    let n;
    try { n = normalizeContent(JSON.parse(await file.text())); } catch (e) { return toast(e.message || '파일을 읽을 수 없어요'); }
    const prev = S().solo.content;
    const merged = prev ? mergeContent(prev, n) : n;
    await store.soloSet('content', JSON.parse(JSON.stringify(merged)));
    const k = contentCounts(mergeContent(base, merged));
    toast(`가져왔어요 · ${k.sessions}회차 · ${k.items}건 · ${k.weeks}주 · ${k.blog}편 (중복 없음, 진도 그대로)`);
  }

  // 백업: 내 공부 부분
  function backupPart() {
    const so = S().solo || {};
    return { settings: so.settings || null, progress: so.progress || {}, blog: so.blog || {}, content: so.content || null };
  }
  async function restorePart(part) {
    if (!part) return;
    if (part.settings) await store.soloSet('settings', part.settings);
    await store.soloSet('progress', part.progress || {});
    await store.soloSet('blog', part.blog || {});
    if (part.content) await store.soloSet('content', part.content);
  }
  function backupSummary(part) {
    if (!part) return '';
    const a = Object.values(part.progress?.assign || {}).filter((x) => x.st === 'completed').length;
    const r = Object.values(part.blog?.a || {}).filter((x) => x.read).length;
    return `내 공부 영상 체크 ${a}개 · 교재 읽음 ${r}편`;
  }

  return {
    ui, renderBody, navHTML, handle, onChange, onInput, onKey, openSettings,
    backupPart, restorePart, backupSummary, content, P, ensureBase,
  };
}
