// ── Flat 2-column view ───────────────────────────────────────────────
//
// 모든 선형 체인을 추출해 글로벌 타임라인으로 펼쳐서
// 최대 2열(짧은 것 왼쪽)로 렌더링한다.
// 기존 중첩 swimlane과 독립적으로 동작.

// ── Step 1: DAG → 선형 체인 추출 ────────────────────────────────────
// chain = { id, tasks[], startAfter: taskId[], endChildren: taskId[] }
function computeFlatChains(tasks) {
  const taskById = Object.fromEntries(tasks.map(t => [t.id, t]));
  const inArea   = new Set(tasks.map(t => t.id));
  const ip = t => (t.parents  || []).filter(p => inArea.has(p));
  const ic = t => (t.children || []).filter(c => inArea.has(c));

  const taskToChain = {};
  const chains = [];

  for (const task of tasks) {
    const parents = ip(task);
    let continued = false;
    if (parents.length === 1) {
      const pChain = taskToChain[parents[0]];
      const parent = taskById[parents[0]];
      if (pChain && ic(parent).length === 1) {
        pChain.tasks.push(task);
        taskToChain[task.id] = pChain;
        continued = true;
      }
    }
    if (!continued) {
      const chain = { id: chains.length, tasks: [task], startAfter: parents };
      chains.push(chain);
      taskToChain[task.id] = chain;
    }
  }
  for (const chain of chains) {
    const last = chain.tasks[chain.tasks.length - 1];
    chain.endChildren = ic(last);
  }
  return chains;
}

// ── Step 2: 글로벌 타임라인 시뮬레이션 + 트랙 할당 ──────────────────
//
// 반환값: { ticks, trackOf, totalTracks, taskToTick, chainStartTick }
//   ticks[t] = [{ chain, task, track }]  (그 틱에서 실행되는 (체인, 태스크, 트랙번호) 목록)
//   trackOf[chainId] = 트랙 번호 (0=가장 왼쪽)
//   totalTracks = 최대 동시 트랙 수
//   taskToTick[taskId] = 그 임무가 표시된 틱 인덱스
//   chainStartTick[chainId] = 그 체인이 시작된 틱 인덱스
//
// 트랙 할당 규칙:
//   - 체인이 시작될 때 남은 길이 기준으로 사용 가능한 최소 트랙에 배정
//   - 짧은 체인일수록 낮은 번호(왼쪽) 트랙 선호
function simulateAndAssignTracks(chains) {
  const taskDone  = new Set();
  const chainDone = new Set();
  const chainStartTick = {}; // chainId → 시작 틱
  const taskToTick     = {}; // taskId → 표시 틱

  for (const c of chains) c._ptr = 0;

  const canStart = c =>
    c._ptr === 0 &&
    !chainDone.has(c.id) &&
    (c.startAfter.length === 0 || c.startAfter.every(pid => taskDone.has(pid)));

  // 트랙 관리: trackFreeAt[i] = 트랙 i가 비는 틱 (이 틱 이후부터 사용 가능)
  const trackFreeAt = [];
  const trackOf     = {}; // chainId → track

  function assignTracks(newChains, currentTick) {
    // 남은 길이 오름차순 → 짧은 것이 낮은(왼쪽) 트랙 우선
    const sorted = [...newChains].sort((a, b) => a.tasks.length - b.tasks.length);
    for (const c of sorted) {
      // 현재 틱 이전에 비어있는(또는 한번도 안쓴) 가장 낮은 트랙
      let best = -1;
      for (let ti = 0; ti < trackFreeAt.length; ti++) {
        if (trackFreeAt[ti] <= currentTick) { best = ti; break; }
      }
      if (best === -1) { best = trackFreeAt.length; trackFreeAt.push(0); }
      trackFreeAt[best] = currentTick + c.tasks.length;
      trackOf[c.id] = best;
      chainStartTick[c.id] = currentTick;
    }
  }

  const ticks = [];
  let active = [];
  let safety = 0;

  while (safety++ < 50000) {
    // 시작 가능한 체인 탐색
    const newChains = chains.filter(c =>
      !chainDone.has(c.id) && !active.includes(c) && canStart(c)
    );
    if (newChains.length) assignTracks(newChains, ticks.length);
    active.push(...newChains);

    if (!active.length) break;

    const tickIdx = ticks.length;
    // 틱 레코드: 활성 체인 각각의 현재 태스크
    const tickRecord = active.map(c => ({
      chain: c,
      task:  c.tasks[c._ptr],
      track: trackOf[c.id],
    }));
    ticks.push(tickRecord);

    // 포인터 전진 & 완료 처리
    for (const c of active) {
      const task = c.tasks[c._ptr];
      taskDone.add(task.id);
      taskToTick[task.id] = tickIdx;
      c._ptr++;
      if (c._ptr >= c.tasks.length) chainDone.add(c.id);
    }
    active = active.filter(c => !chainDone.has(c.id));
  }

  const totalTracks = trackFreeAt.length;
  return { ticks, trackOf, totalTracks, taskToTick, chainStartTick };
}

// ── Step 2.5: 유령선 후보 수집 ───────────────────────────────────────
//
// 각 체인 Y의 startAfter 부모들에 대해, "parent_tick+1 < child_tick"인 경우만 유령선 후보가 됨
// (1틱 거리는 커넥터 직선으로 처리되므로 유령선 불필요)
//
// 반환: [{ parentTaskId, childChainId, parentTick, childTick }, ...]
function collectGhosts(chains, taskToTick, chainStartTick) {
  const ghosts = [];
  for (const Y of chains) {
    const childTick = chainStartTick[Y.id];
    if (childTick === undefined) continue;
    for (const parentId of (Y.startAfter || [])) {
      const parentTick = taskToTick[parentId];
      if (parentTick === undefined) continue;
      if (parentTick + 1 < childTick) {
        ghosts.push({
          parentTaskId: parentId,
          childChainId: Y.id,
          parentTick,
          childTick,
        });
      }
    }
  }
  return ghosts;
}

// ── Step 2.6: 유령선 슬롯 배정 ────────────────────────────────────────
//
// 각 유령선에 side('L'|'R')와 slot(0+)을 부여한다.
//   선호 사이드: 부모 트랙이 짝수면 'L', 홀수면 'R'
//   슬롯 인덱스: 사이드 내에서 가장 안쪽(0)부터 사용. 점유 끝나면 재사용.
//
// 입력: ghosts (collectGhosts 결과), ticks (부모 트랙 조회용)
// 부수효과: 각 ghost 객체에 .parentTrack, .side, .slot 추가
// 반환: { maxLeftSlots, maxRightSlots }
function assignGhostSlots(ghosts, ticks) {
  // taskId → track 매핑
  const taskTrack = {};
  for (const tickEntries of ticks) {
    for (const e of tickEntries) taskTrack[e.task.id] = e.track;
  }
  for (const g of ghosts) g.parentTrack = taskTrack[g.parentTaskId];

  // parentTick 오름차순. 동률이면 긴 유령 먼저(슬롯 점유가 길어 외곽으로 밀려도 OK).
  const sorted = [...ghosts].sort((a, b) => {
    if (a.parentTick !== b.parentTick) return a.parentTick - b.parentTick;
    return (b.childTick - b.parentTick) - (a.childTick - a.parentTick);
  });

  // slots[i] = 그 슬롯이 점유 종료되는 틱 (그 이후엔 비어 재사용 가능)
  const leftSlots  = [];
  const rightSlots = [];
  const findFreeSlot = (slots, fromTick) => {
    for (let i = 0; i < slots.length; i++) {
      if (slots[i] < fromTick) return i;
    }
    slots.push(-Infinity);
    return slots.length - 1;
  };

  for (const g of sorted) {
    const side = (g.parentTrack !== undefined && g.parentTrack % 2 === 1) ? 'R' : 'L';
    const slotsRef = side === 'L' ? leftSlots : rightSlots;
    const slotIdx  = findFreeSlot(slotsRef, g.parentTick + 1);
    slotsRef[slotIdx] = g.childTick - 1;
    g.side = side;
    g.slot = slotIdx;
  }

  return { maxLeftSlots: leftSlots.length, maxRightSlots: rightSlots.length };
}

// 틱별로 그 틱에서 활성인 유령선들을 모은다.
// 반환: ghostsAt[t] = [ghost, ...] (해당 틱에서 표시될 유령)
function buildGhostsAt(ghosts, tickCount) {
  const ghostsAt = Array.from({ length: tickCount }, () => []);
  for (const g of ghosts) {
    for (let t = g.parentTick + 1; t < g.childTick; t++) {
      if (t >= 0 && t < tickCount) ghostsAt[t].push(g);
    }
  }
  return ghostsAt;
}

// ── Step 3: 렌더링 ───────────────────────────────────────────────────

let _flatBcId   = 0;
const _flatMeta = {}; // bcId → { ticks, totalTracks }

function renderFlatView(tasks, inArea) {
  if (!tasks || !tasks.length) return '';

  const chains = computeFlatChains(tasks);
  const sim = simulateAndAssignTracks(chains);
  const { ticks, totalTracks, taskToTick, chainStartTick } = sim;
  if (!ticks.length) return '';

  const ghosts = collectGhosts(chains, taskToTick, chainStartTick);
  const { maxLeftSlots, maxRightSlots } = assignGhostSlots(ghosts, ticks);
  const ghostsAt = buildGhostsAt(ghosts, ticks.length);

  _flatBcId++;
  const bcId = `flat${_flatBcId}`;
  _flatMeta[bcId] = {
    ticks, totalTracks, taskToTick, chainStartTick,
    ghosts, ghostsAt, maxLeftSlots, maxRightSlots,
  };

  const subRowCount = Math.ceil(totalTracks / 2);

  // 한 틱의 유령 슬롯 HTML 생성 (사이드별)
  // 좌측: outer(높은 slot idx) → inner(낮은 slot idx) 순서로 렌더
  // 우측: inner(낮은 slot idx) → outer(높은 slot idx) 순서로 렌더
  function renderGhostSlots(side, maxSlots, tickGhosts) {
    if (!maxSlots) return '';
    const occupiedSet = new Set(tickGhosts.filter(g => g.side === side).map(g => g.slot));
    const slotIdxs = side === 'L'
      ? Array.from({ length: maxSlots }, (_, i) => maxSlots - 1 - i)  // [N-1, ..., 0]
      : Array.from({ length: maxSlots }, (_, i) => i);                // [0, ..., N-1]
    return slotIdxs.map(idx => {
      const cls = `flat-ghost-slot ${occupiedSet.has(idx) ? 'occupied' : ''}`;
      return `<div class="${cls}" data-side="${side}" data-slot="${idx}"></div>`;
    }).join('');
  }

  let body = '';

  ticks.forEach((tickEntries, tickIdx) => {
    const byTrack = {};
    for (const e of tickEntries) byTrack[e.track] = e;

    const tickGhosts = ghostsAt[tickIdx] || [];

    // 필요 sub-row 집합
    const neededSrs = new Set();
    for (let sr = 0; sr < subRowCount; sr++) {
      if (byTrack[sr * 2] || byTrack[sr * 2 + 1]) {
        for (let s = 0; s <= sr; s++) neededSrs.add(s);
      }
    }

    const leftGhostHtml  = renderGhostSlots('L', maxLeftSlots,  tickGhosts);
    const rightGhostHtml = renderGhostSlots('R', maxRightSlots, tickGhosts);

    for (let sr = 0; sr < subRowCount; sr++) {
      if (!neededSrs.has(sr)) continue;

      const leftTrack  = sr * 2;
      const rightTrack = sr * 2 + 1;
      const leftEntry  = byTrack[leftTrack];
      const rightEntry = byTrack[rightTrack];

      // 상위 sub-row 통과선 (sub-row 간 — 유령선과는 다른 기존 개념 유지)
      let leftPass = false, rightPass = false;
      if (sr > 0) {
        for (let t = 0; t < leftTrack;  t += 2) if (byTrack[t]) { leftPass  = true; break; }
        for (let t = 1; t < rightTrack; t += 2) if (byTrack[t]) { rightPass = true; break; }
      }

      const leftHasContent  = !!leftEntry  || leftPass;
      const rightHasContent = !!rightEntry || rightPass;

      // 활성 영역 안의 셀들 — wide / 2-col 모드 선택
      let activeAreaHtml;
      if (leftHasContent && !rightHasContent) {
        const cls = `flat-cell flat-cell-wide${leftEntry ? '' : ' flat-inactive'}${leftPass && !leftEntry ? ' flat-passthrough' : ''}`;
        const inner = leftEntry ? renderQuestItem(leftEntry.task, inArea) : '';
        activeAreaHtml = `<div class="flat-active-area wide"><div class="${cls}" data-track="${leftTrack}">${inner}</div></div>`;
      } else if (!leftHasContent && rightHasContent) {
        const cls = `flat-cell flat-cell-wide${rightEntry ? '' : ' flat-inactive'}${rightPass && !rightEntry ? ' flat-passthrough' : ''}`;
        const inner = rightEntry ? renderQuestItem(rightEntry.task, inArea) : '';
        activeAreaHtml = `<div class="flat-active-area wide"><div class="${cls}" data-track="${rightTrack}">${inner}</div></div>`;
      } else {
        const leftCls  = `flat-cell${leftEntry  ? '' : ' flat-inactive'}${leftPass  && !leftEntry  ? ' flat-passthrough' : ''}`;
        const rightCls = `flat-cell${rightEntry ? '' : ' flat-inactive'}${rightPass && !rightEntry ? ' flat-passthrough' : ''}`;
        const leftHtml = leftEntry
          ? `<div class="${leftCls}" data-track="${leftTrack}">${renderQuestItem(leftEntry.task, inArea)}</div>`
          : `<div class="${leftCls}" data-track="${leftTrack}"></div>`;
        const rightHtml = rightEntry
          ? `<div class="${rightCls}" data-track="${rightTrack}">${renderQuestItem(rightEntry.task, inArea)}</div>`
          : `<div class="${rightCls}" data-track="${rightTrack}"></div>`;
        activeAreaHtml = `<div class="flat-active-area">${leftHtml}${rightHtml}</div>`;
      }

      body += `<div class="flat-row" data-tick="${tickIdx}" data-sr="${sr}">${leftGhostHtml}${activeAreaHtml}${rightGhostHtml}</div>`;
    }

    if (tickIdx < ticks.length - 1) {
      // 커넥터: 다음 틱과 공통 유령선만 occupied 표시
      const nextGhosts = ghostsAt[tickIdx + 1] || [];
      const connectorGhosts = tickGhosts.filter(g =>
        nextGhosts.includes(g)
      );
      const cLeftGhost  = renderGhostSlots('L', maxLeftSlots,  connectorGhosts);
      const cRightGhost = renderGhostSlots('R', maxRightSlots, connectorGhosts);
      body += `<div class="flat-connector" data-bc="${bcId}" data-tick="${tickIdx}">${cLeftGhost}<div class="flat-active-area"></div>${cRightGhost}<svg></svg></div>`;
    }
  });

  return `<div class="flat-body" id="${bcId}">${body}</div>`;
}

// ── SVG 커넥터 ────────────────────────────────────────────────────────
function drawFlatConnectors(bodyEl) {
  const bcId = bodyEl.id;
  const meta = _flatMeta[bcId];
  if (!meta) return;

  const { ticks, ghosts, ghostsAt, taskToTick } = meta;

  bodyEl.querySelectorAll('.flat-connector').forEach(gapEl => {
    const tickIdx = parseInt(gapEl.dataset.tick);
    const Tcur  = tickIdx;
    const Tnext = tickIdx + 1;
    if (Tnext >= ticks.length) return;

    const gRect = gapEl.getBoundingClientRect();
    const w = gRect.width, h = gapEl.offsetHeight;
    if (w < 2 || h < 2) return;

    const curTick  = ticks[Tcur];
    const nextTick = ticks[Tnext];
    if (!curTick || !nextTick) return;

    // ── X/Y 좌표 헬퍼 ──────────────────────────────────────────
    // 특정 틱·트랙의 셀 중심 X. alignToCol을 주면 wide 셀일 때 컬럼 정렬 X 반환(25%/75%).
    function xOfTrackAt(t, track, alignToCol) {
      const sr     = Math.floor(track / 2);
      const ownCol = track % 2;
      const row = bodyEl.querySelector(`.flat-row[data-tick="${t}"][data-sr="${sr}"]`);
      if (!row) return null;
      const area = row.querySelector('.flat-active-area');
      if (!area) return null;
      if (area.classList.contains('wide')) {
        const rect = area.getBoundingClientRect();
        const tgt  = (alignToCol === 0 || alignToCol === 1) ? alignToCol : ownCol;
        return rect.left + rect.width * (tgt === 0 ? 0.25 : 0.75) - gRect.left;
      }
      const cells = [...area.children];
      if (!cells[ownCol]) return null;
      const r = cells[ownCol].getBoundingClientRect();
      return (r.left + r.right) / 2 - gRect.left;
    }

    // 셀의 row top/bottom Y (커넥터 기준, gapEl.top = 0). sr이 달라 connector 밖에 있을 수 있음.
    function rowYAt(t, track, edge /* 'top'|'bottom' */) {
      const sr = Math.floor(track / 2);
      const row = bodyEl.querySelector(`.flat-row[data-tick="${t}"][data-sr="${sr}"]`);
      if (!row) return null;
      const r = row.getBoundingClientRect();
      return (edge === 'top' ? r.top : r.bottom) - gRect.top;
    }

    // 커넥터 안의 유령 슬롯 X
    function ghostSlotX(side, slot) {
      const el = gapEl.querySelector(`.flat-ghost-slot[data-side="${side}"][data-slot="${slot}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return (r.left + r.right) / 2 - gRect.left;
    }

    const stroke = 'rgba(74,144,226,0.7)';
    const lines = [];  // { fromX, fromY, toX, toY }
    function drawLine(fromX, fromY, toX, toY) {
      if (fromX == null || toX == null || fromY == null || toY == null) return;
      lines.push({ fromX, fromY, toX, toY });
    }

    // 1. 연속 체인 (같은 체인이 T, T+1에 모두 활성)
    const curByChain  = new Map(curTick .map(e => [e.chain.id, e]));
    const nextByChain = new Map(nextTick.map(e => [e.chain.id, e]));
    for (const [chainId, curE] of curByChain) {
      const nextE = nextByChain.get(chainId);
      if (!nextE) continue;
      const fromCol = curE.track  % 2;
      const toCol   = nextE.track % 2;
      const fromX = xOfTrackAt(Tcur,  curE.track,  toCol);
      const toX   = xOfTrackAt(Tnext, nextE.track, fromCol);
      const fromY = rowYAt(Tcur,  curE.track,  'bottom');
      const toY   = rowYAt(Tnext, nextE.track, 'top');
      drawLine(fromX, fromY, toX, toY);
    }

    // 2 + 3. 부모 임무 한 곳에서 나가는 outgoing 라인들(새 체인 분기 + 유령선 시작)
    //         을 모아서 부모 셀 내 source X를 분산 배치 (같은 X 중복 방지).
    //
    // 각 라인: { toX, toY, childCol } — childCol은 wide 부모일 때 열정렬용 (유령선은 null)
    const outgoingByParent = new Map();
    const pushOut = (parentId, conn) => {
      if (!outgoingByParent.has(parentId)) outgoingByParent.set(parentId, []);
      outgoingByParent.get(parentId).push(conn);
    };
    // 새 체인 분기 (case 2)
    for (const entry of nextTick) {
      if (curByChain.has(entry.chain.id)) continue;
      for (const parentId of (entry.chain.startAfter || [])) {
        if (taskToTick[parentId] !== Tcur) continue;
        const toX = xOfTrackAt(Tnext, entry.track);
        const toY = rowYAt(Tnext, entry.track, 'top');
        if (toX == null || toY == null) continue;
        pushOut(parentId, { toX, toY, childCol: entry.track % 2 });
      }
    }
    // 유령선 시작 (case 3)
    for (const g of ghosts) {
      if (g.parentTick !== Tcur) continue;
      if (g.childTick <= Tnext) continue;
      const toX = ghostSlotX(g.side, g.slot);
      if (toX == null) continue;
      pushOut(g.parentTaskId, { toX, toY: h, childCol: null });
    }

    // 부모 셀의 (left, width) 영역 (wide면 active-area, 아니면 own 셀)
    function parentCellBounds(parentEntry) {
      const sr = Math.floor(parentEntry.track / 2);
      const ownCol = parentEntry.track % 2;
      const row = bodyEl.querySelector(`.flat-row[data-tick="${Tcur}"][data-sr="${sr}"]`);
      if (!row) return null;
      const area = row.querySelector('.flat-active-area');
      if (!area) return null;
      let rect;
      if (area.classList.contains('wide')) rect = area.getBoundingClientRect();
      else {
        const cells = [...area.children];
        if (!cells[ownCol]) return null;
        rect = cells[ownCol].getBoundingClientRect();
      }
      return { left: rect.left - gRect.left, width: rect.width };
    }

    // 부모별로 source X 결정 후 라인 추가
    for (const [parentId, conns] of outgoingByParent) {
      const parentEntry = curTick.find(e => e.task.id === parentId);
      if (!parentEntry) continue;
      const fromY = rowYAt(Tcur, parentEntry.track, 'bottom');

      // 1차: 각 conn의 "선호" source X 계산
      //   childCol이 있으면 wide 부모는 25%/75%로 정렬, 아니면 cell 중심
      //   childCol이 없는 유령선은 cell 중심
      const prefXs = conns.map(c =>
        c.childCol != null
          ? xOfTrackAt(Tcur, parentEntry.track, c.childCol)
          : xOfTrackAt(Tcur, parentEntry.track)
      );

      // 같은 X(정수 픽셀 기준)에 모이는 conn들을 그룹화 → 그룹 내 분산
      const groups = new Map();
      for (let i = 0; i < conns.length; i++) {
        const key = prefXs[i] != null ? Math.round(prefXs[i]) : 'null';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(i);
      }
      const sourceXs = new Array(conns.length);
      for (const [, idxs] of groups) {
        if (idxs.length === 1) {
          sourceXs[idxs[0]] = prefXs[idxs[0]];
          continue;
        }
        // 그룹 내에서 destination X 오름차순 정렬 후 부모 셀 폭 안에서 균등 분산
        idxs.sort((a, b) => conns[a].toX - conns[b].toX);
        const bounds = parentCellBounds(parentEntry);
        if (!bounds) continue;
        const N = idxs.length;
        for (let j = 0; j < N; j++) {
          const frac = (j + 1) / (N + 1);
          sourceXs[idxs[j]] = bounds.left + bounds.width * frac;
        }
      }

      // 그리기
      for (let i = 0; i < conns.length; i++) {
        const c = conns[i];
        const fromX = sourceXs[i];
        drawLine(fromX, fromY, c.toX, c.toY);
      }
    }

    // 4. 유령선 흡수 (자식틱이 Tnext, 부모틱은 Tcur보다 앞 → 유령에서 자식으로 합류)
    for (const g of ghosts) {
      if (g.childTick !== Tnext) continue;
      if (g.parentTick >= Tcur) continue;  // 1틱(케이스2)
      const childEntry = nextTick.find(e => e.chain.id === g.childChainId);
      if (!childEntry) continue;
      const fromX = ghostSlotX(g.side, g.slot);
      const toX   = xOfTrackAt(Tnext, childEntry.track);
      const toY   = rowYAt(Tnext, childEntry.track, 'top');
      drawLine(fromX, 0, toX, toY);
    }

    // 5. 유령 통과(T, T+1 모두 활성) — CSS 슬롯 ::before가 처리하므로 SVG 생략

    // 같은 X에 같은 시작점인 수직 라인은 가장 긴 것만 남김
    const verticalKey = ln => Math.abs(ln.fromX - ln.toX) < 3 ? `V|${ln.fromX.toFixed(1)}|${ln.fromY.toFixed(1)}` : null;
    const longestVertical = new Map();
    for (const ln of lines) {
      const k = verticalKey(ln);
      if (k == null) continue;
      const cur = longestVertical.get(k);
      if (!cur || ln.toY > cur.toY) longestVertical.set(k, ln);
    }
    const finalLines = lines.filter(ln => {
      const k = verticalKey(ln);
      if (k == null) return true;
      return longestVertical.get(k) === ln;
    });

    const paths = finalLines.map(ln => {
      const { fromX, fromY, toX, toY } = ln;
      const sameX = Math.abs(fromX - toX) < 3;
      const span  = toY - fromY;
      const d = sameX
        ? `M${fromX},${fromY} L${toX},${toY}`
        : `M${fromX},${fromY} C${fromX},${fromY + span*0.55} ${toX},${fromY + span*0.45} ${toX},${toY}`;
      return `<path d="${d}" stroke="${stroke}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
    });

    const svg = gapEl.querySelector('svg');
    svg.removeAttribute('viewBox');
    svg.innerHTML = paths.join('');
  });
}

function drawAllFlatConnectors(containerEl) {
  containerEl.querySelectorAll('.flat-body').forEach(body => drawFlatConnectors(body));
}

// ── 진입점 ────────────────────────────────────────────────────────────
function renderQuestsFlatMode(tasks) {
  const el     = document.getElementById('questList');
  const inArea = new Set(tasks.map(t => t.id));
  _flatBcId = 0;
  Object.keys(_flatMeta).forEach(k => delete _flatMeta[k]);
  el.innerHTML = renderFlatView(tasks, inArea);
  requestAnimationFrame(() => drawAllFlatConnectors(el));
}
