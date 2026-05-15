// ── Render quest item HTML ────────────────────────────────────────
function renderQuestItem(task, inArea) {
  // Virtual nodes: non-interactive, always treated as completed
  if (task._virtual) {
    if (task._virtualType === 'root') {
      // Start marker — subtle, full width
      return `<div class="quest-item done quest-virtual quest-virtual-root">
        <div class="quest-left">
          <div class="quest-header">
            <span class="quest-idx">―</span>
            <span class="quest-desc">시작</span>
            <span class="done-tag">완료</span>
          </div>
        </div>
      </div>`;
    }
    // Sync marker — thin horizontal separator between converging and diverging chains
    return `<div class="quest-virtual-sync"></div>`;
  }

  const isDone = completedTaskIds.has(task.id);
  const available = isTaskAvailable(task, inArea);
  const cls = isDone ? 'done' : available ? 'current' : 'locked';

  const reqs = (task.requirements || []).map(r => {
    const item = DATA.items[r.name] || {};
    const name = t(item.mpcKey, item.name || r.name);
    const url = imgUrl(item.imageUrl);
    const lv = item.level || 1;
    const tip = `${name} (L${lv}) ×${r.amount}`;
    const icon = url
      ? `<img src="${url}" alt="${name}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
      : '';
    const ph = `<div class="req-chip-ph" style="${url ? 'display:none' : ''}">${r.name.slice(0,2)}</div>`;
    const lvBadge = lv > 1 ? `<i class="req-chip-lv">L${lv}</i>` : '';
    return `<span class="req-chip" title="${tip}">${icon}${ph}<i class="req-chip-qty">×${r.amount}</i>${lvBadge}</span>`;
  }).join('');

  const xp = task.rewards?.xp || 0;
  const idToIndex = Object.fromEntries(currentArea.tasks.map(t => [t.id, t.index]));
  const branchIndices = (task.children || [])
    .filter(c => inArea.has(c))
    .map(c => idToIndex[c])
    .filter(n => n !== undefined)
    .sort((a, b) => a - b);

  return `<div class="quest-item ${cls}" onclick="toggleTask('${task.id}')">
    <div class="quest-left">
      <div class="quest-header">
        <span class="quest-idx" title="${t('HotspotDescriptionOverride_'+task.id, '') || t('HotspotDescription_'+task.id, task.desc)}">${task.index}</span>
        <span class="quest-desc" title="${t('HotspotDescriptionOverride_'+task.id, '') || t('HotspotDescription_'+task.id, task.desc)}">${t('HotspotDescriptionOverride_'+task.id, '') || t('HotspotDescription_'+task.id, task.desc)}</span>
        ${isDone ? '<span class="done-tag">완료</span>' : ''}
      </div>
      ${xp ? `<div class="quest-xp">⭐ ${xp} XP</div>` : ''}
      ${branchIndices.length >= 2 ? `<div class="quest-unlock">🔓 <span>${branchIndices.join(', ')}</span></div>` : ''}
    </div>
    ${reqs ? `<div class="quest-reqs">${reqs}</div>` : ''}
  </div>`;
}

// ── Swimlane renderer ─────────────────────────────────────────────
let _bcId = 0;          // unique ID counter for branch sections; reset each render
let _rowTransitions = {}; // bcId → [{fromIdx, toIdxs}[]] per row-gap

function renderSwimlane(columns, inArea) {
  const id = `bc${++_bcId}`;

  // Each lane: { segs, ptr, laneId } — laneId uses dot-notation for hierarchy
  let lanes = columns.map((col, i) => ({
    segs: col, ptr: 0, laneId: String(i)
  }));

  // Collect all rows before building HTML (needed for transition mapping)
  const rowData = []; // each entry: [{laneId, isStrip, task}]
  let safety = 0;

  while (safety++ < 2000) {
    // Expand any lane whose current segment is itself a branch
    let expanded = false;
    for (let i = 0; i < lanes.length; i++) {
      const l = lanes[i];
      if (l.ptr < l.segs.length && l.segs[l.ptr].type === 'branch') {
        const inner = l.segs[l.ptr]; l.ptr++;
        const subs = inner.columns.map((sub, si) => ({
          segs: sub, ptr: 0,
          laneId: l.laneId + '.' + si
        }));
        lanes.splice(i, 1, ...subs);
        expanded = true;
        break;
      }
    }
    if (expanded) continue;
    if (!lanes.some(l => l.ptr < l.segs.length)) break;

    rowData.push(lanes.map(l => {
      const isStrip = l.ptr >= l.segs.length;
      const task = isStrip ? null : l.segs[l.ptr++].task;
      return { laneId: l.laneId, isStrip, task };
    }));
  }

  // Compute row-to-row lane transitions (for bezier connector drawing)
  // A cell in row R maps to cells in row R+1 whose laneId equals or starts with cell's laneId
  const transitions = rowData.slice(0, -1).map((prev, r) => {
    const next = rowData[r + 1];
    return prev.map((cell, fi) => ({
      fromIdx: fi,
      toIdxs: next
        .map((c, ni) => ni)
        .filter(ni => {
          const lid = next[ni].laneId;
          return lid === cell.laneId || lid.startsWith(cell.laneId + '.');
        })
    }));
  });
  _rowTransitions[id] = transitions;

  // Build HTML: level-rows interleaved with row-connector gaps
  let body = '';
  rowData.forEach((cells, r) => {
    const rowHtml = cells.map(c =>
      c.isStrip
        ? `<div class="level-strip" data-lane="${c.laneId}"></div>`
        : `<div class="level-cell" data-lane="${c.laneId}">${renderQuestItem(c.task, inArea)}</div>`
    ).join('');
    body += `<div class="level-row">${rowHtml}</div>`;
    if (r < rowData.length - 1) {
      body += `<div class="row-connector" data-bc="${id}" data-row="${r}"><svg></svg></div>`;
    }
  });

  return [
    `<div class="branch-split-gap" data-bc="${id}"><svg></svg></div>`,
    `<div class="swimlane-body" id="${id}">${body}</div>`,
    `<div class="branch-merge-gap" data-bc="${id}"><svg></svg></div>`
  ].join('');
}

function renderSegments(segments, inArea) {
  return segments.map(seg => {
    if (seg.type === 'linear') return renderQuestItem(seg.task, inArea);
    return renderSwimlane(seg.columns, inArea);
  }).join('');
}

// ── SVG connector drawing ─────────────────────────────────────────

// Split-gap / merge-gap connectors (outer branch boundaries)
function drawConnector(gapEl, isMerge) {
  const bodyEl = document.getElementById(gapEl.dataset.bc);
  if (!bodyEl) return;
  const gRect = gapEl.getBoundingClientRect();
  const w = gRect.width, h = gapEl.offsetHeight;
  if (w < 2 || h < 2) return;

  const rows = [...bodyEl.querySelectorAll(':scope > .level-row')];
  if (!rows.length) return;

  const refRow = isMerge ? rows[rows.length - 1] : rows[0];
  // For split: only active cells (first row never has strips).
  // For merge: include strips too — exhausted lanes are also prerequisites of the merge task.
  const cells = isMerge
    ? [...refRow.children]
    : [...refRow.querySelectorAll(':scope > .level-cell')];
  if (!cells.length) return;

  const stroke = 'rgba(74,144,226,0.7)';
  const fullCx = w / 2;
  const svg = gapEl.querySelector('svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

  svg.innerHTML = cells.map(cell => {
    const r = cell.getBoundingClientRect();
    const colX = (r.left + r.right) / 2 - gRect.left;
    const isStrip = cell.classList.contains('level-strip');
    const sw = isStrip ? 4 : 2;
    const d = isMerge
      ? `M${colX},0 C${colX},${h*0.55} ${fullCx},${h*0.45} ${fullCx},${h}`
      : `M${fullCx},0 C${fullCx},${h*0.55} ${colX},${h*0.45} ${colX},${h}`;
    return `<path d="${d}" stroke="${stroke}" stroke-width="${sw}" fill="none"/>`;
  }).join('');
}

// Row-to-row connectors (within a swimlane, between consecutive level-rows)
function drawRowConnector(gapEl) {
  const id = gapEl.dataset.bc;
  const rowIdx = parseInt(gapEl.dataset.row);
  const transitions = _rowTransitions[id];
  if (!transitions || !transitions[rowIdx]) return;

  const bodyEl = document.getElementById(id);
  if (!bodyEl) return;

  const rows = [...bodyEl.querySelectorAll(':scope > .level-row')];
  const fromRow = rows[rowIdx];
  const toRow = rows[rowIdx + 1];
  if (!fromRow || !toRow) return;

  const gRect = gapEl.getBoundingClientRect();
  const w = gRect.width, h = gapEl.offsetHeight;
  if (w < 2 || h < 2) return;

  const fromCells = [...fromRow.children];
  const toCells = [...toRow.children];
  const stroke = 'rgba(74,144,226,0.7)';
  const paths = [];

  transitions[rowIdx].forEach(({ fromIdx, toIdxs }) => {
    const fromCell = fromCells[fromIdx];
    if (!fromCell) return;
    const fr = fromCell.getBoundingClientRect();
    const fromX = (fr.left + fr.right) / 2 - gRect.left;
    const isFromStrip = fromCell.classList.contains('level-strip');

    toIdxs.forEach(ti => {
      const toCell = toCells[ti];
      if (!toCell) return;
      const tr = toCell.getBoundingClientRect();
      const toX = (tr.left + tr.right) / 2 - gRect.left;
      const isToStrip = toCell.classList.contains('level-strip');

      const sw = (isFromStrip && isToStrip) ? 4 : 2;
      const sameX = Math.abs(fromX - toX) < 3;
      const d = sameX
        ? `M${fromX},0 L${toX},${h}`
        : `M${fromX},0 C${fromX},${h * 0.6} ${toX},${h * 0.4} ${toX},${h}`;
      paths.push(`<path d="${d}" stroke="${stroke}" stroke-width="${sw}" fill="none" stroke-linecap="round"/>`);
    });
  });

  const svg = gapEl.querySelector('svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.innerHTML = paths.join('');
}

function drawAllConnectors(containerEl) {
  containerEl.querySelectorAll('.branch-split-gap').forEach(g => drawConnector(g, false));
  containerEl.querySelectorAll('.branch-merge-gap').forEach(g => drawConnector(g, true));
  containerEl.querySelectorAll('.row-connector').forEach(g => drawRowConnector(g));
}

// ── Panel renderers ───────────────────────────────────────────────
function renderQuests(tasks) {
  const el = document.getElementById('questList');
  const inArea = new Set(tasks.map(t => t.id));
  _bcId = 0;
  _rowTransitions = {};
  const segments = computeSegments(tasks);
  el.innerHTML = renderSegments(segments, inArea);

  requestAnimationFrame(() => {
    drawAllConnectors(el);
    const cur = el.querySelector('.quest-item.current');
    if (!cur) return;
    const allItems = [...el.querySelectorAll('.quest-item')];
    const idx = allItems.indexOf(cur);
    if (idx <= 0) {
      el.scrollTop = 0;
    } else {
      // Scroll so the task just above the current task sits at the bottom of the viewport
      const prev = allItems[idx - 1];
      const containerRect = el.getBoundingClientRect();
      const prevRect = prev.getBoundingClientRect();
      el.scrollTop += prevRect.bottom - containerRect.bottom + 8;
    }
  });
}

function renderItems(tasks) {
  const el = document.getElementById('itemsList');
  const remaining = tasks.filter(t => !completedTaskIds.has(t.id));
  const totals = {};
  for (const task of remaining)
    for (const req of task.requirements)
      totals[req.name] = (totals[req.name] || 0) + req.amount;

  const entries = Object.entries(totals).sort((a, b) => {
    const ia = DATA.items[a[0]] || {}, ib = DATA.items[b[0]] || {};
    const ca = ia.chainName || a[0], cb = ib.chainName || b[0];
    if (ca !== cb) return ca.localeCompare(cb);
    return (ib.level || 1) - (ia.level || 1);
  });
  if (!entries.length) { el.innerHTML = '<div class="empty">없음 🎉</div>'; return; }

  if (itemViewCompact) {
    el.innerHTML = `<div class="items-compact-grid">${entries.map(([id, qty]) => {
      const item = DATA.items[id] || {};
      const name = t(item.mpcKey, item.name || id);
      const lv = item.level || 1;
      const url = imgUrl(item.imageUrl);
      const tip = `${name} (L${lv}) ×${qty}`;
      const icon = url
        ? `<img src="${url}" alt="${name}" title="${tip}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
        : '';
      const ph = `<div class="item-chip-ph" title="${tip}" style="${url ? 'display:none' : ''}">${id.slice(0,3)}</div>`;
      return `<div class="item-chip">${icon}${ph}<span class="item-chip-qty">×${qty}</span><span class="item-chip-lv">L${lv}</span></div>`;
    }).join('')}</div>`;
  } else {
    el.innerHTML = entries.map(([id, qty]) => {
      const item = DATA.items[id] || {};
      const name = t(item.mpcKey, item.name || id);
      const chain = item.chainName || '';
      const url = imgUrl(item.imageUrl);
      const icon = url
        ? `<img src="${url}" alt="${name}" loading="lazy" onerror="this.parentElement.querySelector('.item-icon-ph').style.display='flex';this.style.display='none'">`
        : '';
      const ph = `<div class="item-icon-ph" style="${url ? 'display:none' : ''}">${id.slice(0,3)}</div>`;
      return `<div class="item-row">${icon}${ph}
        <div class="item-info">
          <div class="item-name" title="${name}">${name}</div>
          <div class="item-chain">${chain}</div>
        </div>
        <div class="item-qty">×${qty}</div>
      </div>`;
    }).join('');
  }
}

function toggleItemView() {
  itemViewCompact = !itemViewCompact;
  document.getElementById('itemViewToggle').textContent = itemViewCompact ? '목록' : '아이콘';
  if (currentArea) renderItems(currentArea.tasks);
}

function renderRewards(tasks) {
  const el = document.getElementById('rewardsList');
  const remaining = tasks.filter(t => !completedTaskIds.has(t.id));
  let totalXP = 0;
  const items = {};
  for (const task of remaining) {
    totalXP += task.rewards?.xp || 0;
    if (task.rewards?.item)
      items[task.rewards.item] = (items[task.rewards.item] || 0) + 1;
  }

  if (!totalXP && !Object.keys(items).length) {
    el.innerHTML = '<div class="empty">없음 🎉</div>'; return;
  }

  const chips = [];
  if (totalXP) {
    const label = totalXP >= 1000 ? `${(totalXP/1000).toFixed(1).replace(/\.0$/,'')}k` : String(totalXP);
    chips.push(`<div class="item-chip" title="경험치 ${totalXP.toLocaleString()} XP">
      <div class="xp-chip-inner">⭐</div>
      <span class="item-chip-qty">${label}</span>
    </div>`);
  }
  for (const [id, cnt] of Object.entries(items)) {
    const item = DATA.items[id] || {};
    const name = t(item.mpcKey, item.name || id);
    const lv = item.level || 1;
    const url = imgUrl(item.imageUrl);
    const tip = `${name} (L${lv})`;
    const icon = url
      ? `<img src="${url}" alt="${name}" title="${tip}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
      : '';
    const ph = `<div class="item-chip-ph" title="${tip}" style="${url ? 'display:none' : ''}">${id.slice(0,3)}</div>`;
    chips.push(`<div class="item-chip">${icon}${ph}${cnt > 1 ? `<span class="item-chip-qty">×${cnt}</span>` : ''}<span class="item-chip-lv">L${lv}</span></div>`);
  }
  el.innerHTML = `<div class="items-compact-grid">${chips.join('')}</div>`;
}
