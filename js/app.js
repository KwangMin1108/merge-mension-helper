// ── URL routing ───────────────────────────────────────────────────
function areaToSlug(area) {
  return area.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function findAreaBySlug(slug) {
  const q = decodeURIComponent(slug).toLowerCase().replace(/-/g, ' ');
  return DATA.areas.find(a =>
    a.name.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').trim().includes(q) ||
    (a.nameKo && a.nameKo.includes(decodeURIComponent(slug)))
  );
}

async function handleHash() {
  if (!DATA) return;
  const h = location.hash.slice(1);
  if (h) {
    const slug = h.split('/')[0];
    const area = findAreaBySlug(slug);
    if (area) { await _openArea(area); return; }
  }
  showAreaList();
}

// ── Load data ─────────────────────────────────────────────────────
// Startup: fetch area index + items in parallel (tasks loaded per-area on demand)
async function loadData() {
  const lang = detectLang();
  const [areasResp, itemsResp, i18nResp] = await Promise.all([
    fetch('data/areas.json'),
    fetch('data/items.json'),
    fetch(`data/i18n/${lang}.json`)
  ]);
  const [areas, items] = await Promise.all([areasResp.json(), itemsResp.json()]);
  DATA = { areas, items };
  try {
    I18N = await i18nResp.json();
    currentLang = lang;
    document.documentElement.lang = lang;
    document.querySelectorAll('.lang-select').forEach(s => s.value = lang);
  } catch(e) {}
  document.getElementById('loading').style.display = 'none';
  handleHash();
}

// Inject virtual nodes to normalize the DAG for computeSegments.
//
// Two cases handled:
//   1. Root: multiple tasks with no in-area parents
//      → prepend a virtual root node that parents all of them
//   2. Sync: multiple tasks sharing the same multi-parent set
//      → insert a virtual sync node between those parents and children
//      e.g.  10 ─┐              10 ─┐
//                ├→ 33, 60   →       ├→ V(sync) → 33
//            32 ─┘              32 ─┘           → 60
//
// Virtual node IDs use the '__vnode_N__' prefix so isTaskAvailable()
// can treat them as always-complete without a global constant.
function injectVirtualNodes(tasks) {
  const inArea = new Set(tasks.map(t => t.id));
  let vnodeCounter = 0;
  const makeId = () => `__vnode_${vnodeCounter++}__`;

  // Collect all injections needed before mutating anything
  const injections = [];

  // Case 1: multiple roots
  const roots = tasks.filter(t =>
    (t.parents || []).filter(p => inArea.has(p)).length === 0
  );
  if (roots.length > 1) {
    injections.push({
      type: 'root',
      vId: makeId(),
      parentIds: [],
      childIds: roots.map(r => r.id)
    });
  }

  // Case 2: tasks grouped by identical multi-parent set
  const byParentKey = new Map();
  for (const t of tasks) {
    const ps = (t.parents || []).filter(p => inArea.has(p)).sort();
    if (ps.length >= 2) {
      const key = ps.join(',');
      if (!byParentKey.has(key)) byParentKey.set(key, { parentIds: ps, childIds: [] });
      byParentKey.get(key).childIds.push(t.id);
    }
  }
  for (const { parentIds, childIds } of byParentKey.values()) {
    if (childIds.length >= 2) {
      injections.push({ type: 'sync', vId: makeId(), parentIds, childIds });
    }
  }

  if (injections.length === 0) return tasks;

  // Apply all injections: work on a mutable copy of each task
  const taskMap = new Map(tasks.map(t => [t.id, { ...t,
    parents:  [...(t.parents  || [])],
    children: [...(t.children || [])]
  }]));

  const vnodeTasks = [];

  for (const { type, vId, parentIds, childIds } of injections) {
    const childSet = new Set(childIds);

    // Update parent tasks: replace childIds entries with vId (once, deduped)
    for (const pid of parentIds) {
      const p = taskMap.get(pid);
      if (!p) continue;
      p.children = p.children.filter(c => !childSet.has(c));
      if (!p.children.includes(vId)) p.children.push(vId);
    }

    // Update child tasks: replace the shared parent set with vId
    const parentSet = new Set(parentIds);
    for (const cid of childIds) {
      const c = taskMap.get(cid);
      if (!c) continue;
      c.parents = c.parents.filter(p => !parentSet.has(p));
      if (!c.parents.includes(vId)) c.parents.unshift(vId);
    }

    vnodeTasks.push({
      id: vId,
      _virtual: true,
      _virtualType: type,   // 'root' | 'sync'
      index: -1,
      desc: '',
      requirements: [],
      rewards: {},
      parents:  [...parentIds],
      children: [...childIds]
    });
  }

  // Rebuild array: updated originals + vnodes inserted at correct positions
  let result = tasks.map(t => taskMap.get(t.id) || t);

  for (const vnode of vnodeTasks) {
    if (vnode._virtualType === 'root') {
      result.unshift(vnode);
    } else {
      // Insert after the last parent in the current array
      const positions = vnode.parents.map(pid => result.findIndex(t => t.id === pid));
      const insertAfter = Math.max(...positions);
      result.splice(insertAfter + 1, 0, vnode);
    }
  }

  return result;
}

// Load full area data (tasks) on first access; cached on the area object.
async function loadAreaTasks(area) {
  if (area.tasks) return; // already loaded
  const resp = await fetch(`data/areas/${area.slug}.json`);
  const full = await resp.json();
  area.tasks = injectVirtualNodes(full.tasks || []);
}

// ── Screen: Area List ─────────────────────────────────────────────
function showAreaList() {
  history.replaceState(null, '', location.pathname + location.search);
  showScreen('screenAreas');
  const saved = JSON.parse(localStorage.getItem('mmh_progress') || '{}');
  const container = document.getElementById('areaList');
  container.innerHTML = '';

  let firstInProgress = null;
  DATA.areas.filter(a => (a.taskCount || 0) > 0).forEach(area => {
    const rawVal = saved[area.name];
    const done = typeof rawVal === 'number' ? rawVal
      : Array.isArray(rawVal) ? rawVal.length : 0;
    const total = area.taskCount || 0;
    const pct = total > 0 ? Math.round(done / total * 100) : 0;
    const isDone = done >= total && total > 0;

    const card = document.createElement('div');
    card.className = 'area-card';
    card.innerHTML = `
      <div style="min-width:0;flex:1">
        <div class="area-name-ko">${area.nameKo || area.name}</div>
        <div class="area-name-en">${area.nameKo ? area.name : ''}</div>
      </div>
      <div class="area-progress ${isDone ? 'area-done' : ''}">
        ${done > 0 ? `${done}/${total} (${pct}%)` : `${total}개`}
      </div>`;
    card.onclick = () => openArea(area);
    container.appendChild(card);
    if (!firstInProgress && done > 0 && !isDone) firstInProgress = card;
  });
  if (firstInProgress) {
    requestAnimationFrame(() => firstInProgress.scrollIntoView({ block: 'center', behavior: 'instant' }));
  }
}

// ── Screen: Area Detail ───────────────────────────────────────────
function openArea(area) {
  history.pushState(null, '', `#${areaToSlug(area)}`);
  _openArea(area);
}

async function _openArea(area) {
  // Show screen immediately with a loading indicator, then render once tasks arrive
  showScreen('screenArea');
  document.getElementById('areaTitle').textContent = area.nameKo || area.name;
  document.getElementById('areaSub').textContent = '로딩 중…';
  await loadAreaTasks(area);
  currentArea = area;
  completedTaskIds = loadCompletedIds(area);
  render();
}

function render() {
  if (!currentArea) return;
  const tasks = currentArea.tasks;
  const done = completedTaskIds.size;
  const total = tasks.filter(t => !t._virtual).length;
  const pct = total > 0 ? Math.round(done / total * 100) : 0;

  document.getElementById('areaSub').textContent = `${currentArea.name} · ${done}/${total} 완료`;
  document.getElementById('progressPct').textContent = `${pct}%`;
  document.getElementById('progressFill').style.width = `${pct}%`;

  renderQuests(tasks);
  renderItems(tasks);
  renderRewards(tasks);
}

// ── Screen helpers ────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── Boot ──────────────────────────────────────────────────────────
window.addEventListener('popstate', handleHash);

loadData().catch(err => {
  document.getElementById('loading').innerHTML = `
    <div style="color:var(--accent);font-size:16px">❌ 데이터 로드 실패</div>
    <div style="color:var(--text-dim);font-size:12px;margin-top:8px">${err.message}</div>
    <div style="color:var(--text-dim);font-size:11px;margin-top:12px">로컬 실행 시: <code>python3 -m http.server</code></div>`;
});
