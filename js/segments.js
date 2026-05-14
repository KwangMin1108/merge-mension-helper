// ── Branch layout: DAG → segment tree ────────────────────────────
//
// Returns a flat list of segments:
//   { type: 'linear', task }
//   { type: 'branch', columns: [[task, ...], ...] }
//
// Multiple independent starting chains are handled by injectVirtualRoot()
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

  const segments = [];
  const processedIds = new Set();

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    if (processedIds.has(task.id)) continue;

    const forwardChildren = (task.children || []).filter(c => inArea.has(c));

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

      // Collect ordered tasks for each column from the tasks array
      const colArrays = exclusiveSets.map(() => []);
      for (let j = i + 1; j < tasks.length; j++) {
        const t = tasks[j];
        if (mergeIds.has(t.id)) break;
        if (processedIds.has(t.id)) continue;
        for (let ci = 0; ci < exclusiveSets.length; ci++) {
          if (exclusiveSets[ci].has(t.id)) {
            colArrays[ci].push(t);
            processedIds.add(t.id);
            break;
          }
        }
      }

      if (colArrays.some(col => col.length > 0)) {
        segments.push({ type: 'branch', columns: colArrays });
      }
    } else {
      segments.push({ type: 'linear', task });
      processedIds.add(task.id);
    }
  }

  return segments;
}
