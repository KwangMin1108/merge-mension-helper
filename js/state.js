// ── Constants ─────────────────────────────────────────────────────
const VIRTUAL_ROOT_ID = '__root__';

// ── Global state ──────────────────────────────────────────────────
let DATA = null;
let currentArea = null;
let completedTaskIds = new Set();
let itemViewCompact = true;

// ── Utility ───────────────────────────────────────────────────────
function imgUrl(url) {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return url.split('/').map(encodeURIComponent).join('/');
}

// ── Persistence ───────────────────────────────────────────────────
function saveState() {
  const saved = JSON.parse(localStorage.getItem('mmh_progress') || '{}');
  if (currentArea) saved[currentArea.name] = [...completedTaskIds];
  localStorage.setItem('mmh_progress', JSON.stringify(saved));
}

function loadCompletedIds(area) {
  const val = JSON.parse(localStorage.getItem('mmh_progress') || '{}')[area.name];
  if (!val) return new Set();
  // Migration: if stored as a number, convert to first N real task IDs (skip virtual)
  if (typeof val === 'number') {
    const real = area.tasks.filter(t => !t._virtual);
    return new Set(real.slice(0, val).map(t => t.id));
  }
  return new Set(val);
}

// ── Task availability ─────────────────────────────────────────────
function isTaskAvailable(task, inArea) {
  const parents = (task.parents || []).filter(p => inArea.has(p));
  // Virtual root is always treated as completed
  return parents.every(p => p === VIRTUAL_ROOT_ID || completedTaskIds.has(p));
}

// ── Toggle task completion ────────────────────────────────────────
function toggleTask(taskId) {
  const tasks = currentArea.tasks;
  const inArea = new Set(tasks.map(t => t.id));
  const task = tasks.find(t => t.id === taskId);

  if (completedTaskIds.has(taskId)) {
    // Already done → undo: cascade-remove this task and all dependents
    const toRemove = new Set([taskId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const t of tasks) {
        if (!toRemove.has(t.id) && completedTaskIds.has(t.id)) {
          const parents = (t.parents || []).filter(p => inArea.has(p));
          if (parents.some(p => toRemove.has(p))) {
            toRemove.add(t.id);
            changed = true;
          }
        }
      }
    }
    for (const id of toRemove) completedTaskIds.delete(id);

  } else if (isTaskAvailable(task, inArea)) {
    // Current (available, not yet done) → mark this task as done
    completedTaskIds.add(taskId);

  } else {
    // Locked (not yet available) → cascade-complete ancestors only.
    // The task itself stays incomplete and naturally becomes "current".
    const taskById = Object.fromEntries(tasks.map(t => [t.id, t]));
    const toComplete = [];
    const seen = new Set();
    const q = [...(task?.parents || []).filter(p => inArea.has(p))];
    while (q.length) {
      const id = q.shift();
      if (seen.has(id) || completedTaskIds.has(id)) continue;
      seen.add(id);
      toComplete.push(id);
      for (const p of (taskById[id]?.parents || []).filter(p => inArea.has(p)))
        q.push(p);
    }
    for (const id of toComplete) completedTaskIds.add(id);
  }

  saveState();
  history.replaceState(null, '', `#${areaToSlug(currentArea)}`);
  render();
}
