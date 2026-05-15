// ── Branch layout: DAG → segment tree ────────────────────────────
//
// Returns a nested segment list:
//   { type: 'linear', task }
//   { type: 'branch', columns: [segment[], segment[], ...] }
//
// Columns are themselves arrays of segments, enabling nested branches.
// Multiple independent starting chains are handled by injectVirtualNodes()
// in app.js, which prepends a virtual task that parents all root tasks.

function computeSegments(tasks) {
  const inArea = new Set(tasks.map(t => t.id));
  const taskById = Object.fromEntries(tasks.map(t => [t.id, t]));

  // Compute full descendant set for a task (following children within area)
  const descCache = {};
  function getDescendants(taskId) {
    if (descCache[taskId]) return descCache[taskId];
    const visited = new Set();
    const q = [taskId];
    while (q.length) {
      const cur = q.shift();
      if (visited.has(cur)) continue;
      visited.add(cur);
      for (const ch of (taskById[cur]?.children || [])) {
        if (inArea.has(ch)) q.push(ch);
      }
    }
    descCache[taskId] = visited;
    return visited;
  }

  // processedIds is shared across all recursive calls to prevent double-processing
  const processedIds = new Set();

  function buildSegments(taskList) {
    const segments = [];
    const inCurrentList = new Set(taskList.map(t => t.id));

    for (let i = 0; i < taskList.length; i++) {
      const task = taskList[i];
      if (processedIds.has(task.id)) continue;

      const forwardChildren = (task.children || []).filter(c => inCurrentList.has(c));

      if (forwardChildren.length >= 2) {
        segments.push({ type: 'linear', task });
        processedIds.add(task.id);

        // Compute descendant sets for each branch child
        const childDescs = forwardChildren.map(c => getDescendants(c));

        // Merge points: reachable from ALL branch children
        const mergeIds = new Set([...childDescs[0]].filter(id =>
          childDescs.every(ds => ds.has(id))
        ));

        // Exclusive tasks per branch (not in merge set)
        const exclusiveSets = childDescs.map(ds =>
          new Set([...ds].filter(id => !mergeIds.has(id)))
        );

        // Collect ordered tasks for each column from taskList.
        // Skip merge tasks (continue, not break) so that exclusive tasks
        // appearing after a merge task in index order are still collected.
        const colTaskLists = exclusiveSets.map(() => []);
        for (let j = i + 1; j < taskList.length; j++) {
          const t = taskList[j];
          if (mergeIds.has(t.id)) continue;   // skip merge tasks — do NOT break
          if (processedIds.has(t.id)) continue;
          for (let ci = 0; ci < exclusiveSets.length; ci++) {
            if (exclusiveSets[ci].has(t.id)) {
              colTaskLists[ci].push(t);
              break;
            }
          }
        }

        // Recursively build segments for each column's task list
        const colSegments = colTaskLists.map(colTasks => buildSegments(colTasks));

        if (colSegments.some(col => col.length > 0)) {
          segments.push({ type: 'branch', columns: colSegments });
        }
      } else {
        segments.push({ type: 'linear', task });
        processedIds.add(task.id);
      }
    }

    return segments;
  }

  return buildSegments(tasks);
}
