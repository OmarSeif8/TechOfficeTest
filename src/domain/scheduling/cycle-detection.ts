/**
 * Cycle Detection — DFS-based topological analysis for the CPM network.
 *
 * Implements BR-P14 from SPEC_PHASE2_WEB.md §3.
 *
 * Per CONSTITUTION_V1.1_WEB §3.3 — this file is isomorphic:
 *   - Imports only @shared/* (and stdlib).
 *   - MUST NOT import next, react, prisma, fs, path, electron, etc.
 *
 * Law:
 *   - BR-P14: Cycles are rejected, never traversed. On detection return a
 *             structured list of the cycle's activity IDs. The engine MUST
 *             terminate on any input.
 *
 * Algorithm: classic white/gray/black DFS coloring. Visiting a gray node
 * signals a back edge → cycle. The cycle is the slice of the current DFS path
 * starting at the re-encountered gray node, ending at the current node.
 *
 * Complexity: O(V + E) time, O(V) space. Terminates on any input (every node
 * visited at most once per color transition).
 */

import type {
  ActivityInput,
  RelationshipInput,
} from "@shared/schemas/scheduling/network";

const WHITE = 0; // unvisited
const GRAY = 1; // in current DFS path
const BLACK = 2; // finished

/**
 * Build adjacency list (predecessorId → [successorId, ...]).
 *
 * Self-loops and unknown endpoints are passed through silently here —
 * the CPM engine's BR-P16 validation layer handles those as structured
 * validation errors before cycle detection runs.
 */
function buildAdjacency(
  activities: ActivityInput[],
  relationships: RelationshipInput[],
): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const a of activities) adj.set(a.id, []);
  for (const r of relationships) {
    const list = adj.get(r.predecessorId);
    if (list !== undefined) {
      list.push(r.successorId);
    }
    // If predecessor is unknown (not in `activities`), skip — validation will catch it.
  }
  return adj;
}

/**
 * Detect a cycle in the activity graph.
 *
 * @param activities    list of activity inputs
 * @param relationships list of relationship inputs
 * @returns the activity IDs forming the first detected cycle, in cycle order
 *          (e.g. ["A", "B"] for A→B→A); or `null` if the graph is acyclic.
 */
export function detectCycle(
  activities: ActivityInput[],
  relationships: RelationshipInput[],
): string[] | null {
  const adj = buildAdjacency(activities, relationships);

  const color = new Map<string, number>();
  for (const a of activities) color.set(a.id, WHITE);

  // Sort entry points by their input order so detection is deterministic.
  // (Iterating a Map preserves insertion order, but we walk activities[] directly
  // to be safe against any caller that may have pre-shuffled the map.)
  const orderedIds = activities.map((a) => a.id);

  let foundCycle: string[] | null = null;

  // Iterative DFS to avoid stack overflow on large networks (BR-P14: must terminate).
  // Each stack frame: [node, indexIntoAdjacency]
  for (const startId of orderedIds) {
    if (color.get(startId) !== WHITE) continue;
    if (foundCycle) break;

    const stack: Array<{ id: string; nextChildIdx: number; path: string[] }> = [];
    color.set(startId, GRAY);
    stack.push({ id: startId, nextChildIdx: 0, path: [startId] });

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const children = adj.get(frame.id) ?? [];

      if (frame.nextChildIdx >= children.length) {
        // Done with this node — pop, mark black.
        color.set(frame.id, BLACK);
        stack.pop();
        continue;
      }

      const childId = children[frame.nextChildIdx];
      frame.nextChildIdx += 1;

      const childColor = color.get(childId);
      if (childColor === BLACK) {
        // Cross/forward edge — skip.
        continue;
      }
      if (childColor === GRAY) {
        // Back edge → cycle. Slice from the child's first appearance to the
        // current node, then append the child to close the loop visually
        // (the spec example "naming A and B" implies the unique set, not
        // the closed-loop variant, so we return just the unique IDs).
        const startIdx = frame.path.indexOf(childId);
        foundCycle = frame.path.slice(startIdx);
        break;
      }
      // WHITE — recurse.
      color.set(childId, GRAY);
      stack.push({
        id: childId,
        nextChildIdx: 0,
        path: [...frame.path, childId],
      });
    }
  }

  return foundCycle;
}

/**
 * Topological sort — Kahn's algorithm (BFS over in-degree).
 *
 * Returns the activity IDs in topological order (predecessors before successors).
 * Throws if the graph has a cycle (use `detectCycle` first to handle that case
 * structurally per BR-P14).
 */
export function topologicalSort(
  activities: ActivityInput[],
  relationships: RelationshipInput[],
): string[] {
  const adj = buildAdjacency(activities, relationships);
  const inDegree = new Map<string, number>();
  for (const a of activities) inDegree.set(a.id, 0);

  for (const r of relationships) {
    if (!inDegree.has(r.successorId)) continue; // unknown successor — validation catches
    inDegree.set(r.successorId, (inDegree.get(r.successorId) ?? 0) + 1);
  }

  // Use activities[] order for tie-breaking determinism.
  const queue: string[] = [];
  for (const a of activities) {
    if ((inDegree.get(a.id) ?? 0) === 0) queue.push(a.id);
  }

  const result: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    result.push(id);
    const children = adj.get(id) ?? [];
    for (const childId of children) {
      const d = (inDegree.get(childId) ?? 0) - 1;
      inDegree.set(childId, d);
      if (d === 0) queue.push(childId);
    }
  }

  if (result.length !== activities.length) {
    throw new Error(
      "topologicalSort: graph has a cycle (call detectCycle first)",
    );
  }
  return result;
}
