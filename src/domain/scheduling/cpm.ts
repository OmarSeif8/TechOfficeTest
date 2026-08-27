/**
 * CPM Engine — pure Critical Path Method computation.
 *
 * Implements BR-P10..P13, BR-P15, BR-P16 from SPEC_PHASE2_WEB.md §3.
 *
 * Per CONSTITUTION_V1.1_WEB §3.3 — this file is isomorphic:
 *   - Imports only @shared/* (and stdlib).
 *   - MUST NOT import next, react, prisma, fs, path, electron, etc.
 *
 * Law (golden tests are the authoritative source of truth — tests/golden/gt-p*.test.ts):
 *   - BR-P2: Pure function. Same input → byte-identical output. No Date.now(),
 *            no Math.random(), no I/O. (Determinism test: 100× same input →
 *            identical output, by contract.)
 *   - BR-P3: Durations are working-day counts, integers ≥ 0. Milestone (dur=0)
 *            has ES = EF.
 *   - BR-P4: Lag is an integer, any sign, in working days.
 *   - BR-P7: ALL engine arithmetic happens in working-day indices. Dates
 *            convert at the calendar boundary only.
 *   - BR-P10: Forward pass:
 *        ES(a) = max over relationship bounds; open-start activities → ES = 1
 *                (first working day ≥ project start, per BR-P8).
 *        EF(a) = ES(a) + durationSpan(a), where durationSpan = max(0, dur-1).
 *        (For dur=0: EF = ES. For dur>0: EF = ES + dur - 1.)
 *
 *        Relationship bounds (successor `s` given predecessor `p`, lag `L`):
 *          FS: ES(s) ≥ EF(p) + 1 + L
 *          SS: ES(s) ≥ ES(p) + L
 *          FF: ES(s) ≥ EF(p) + L - durationSpan(s)
 *          SF: ES(s) ≥ ES(p) + L - durationSpan(s)
 *
 *   - BR-P11: Backward pass:
 *        Project finish = max EF (in index space).
 *        For no-successor: LF = project finish.
 *        Otherwise LF(a) = min over relationship bounds.
 *        LS(a) = LF(a) - durationSpan(a).
 *
 *        Backward bounds (predecessor `p` given successor `s`, lag `L`):
 *          FS: LF(p) ≤ LS(s) - 1 - L
 *          FF: LF(p) ≤ LF(s) - L
 *          SS: LF(p) ≤ LS(s) - L + durationSpan(p)
 *          SF: LF(p) ≤ LF(s) - L + durationSpan(p)
 *
 *   - BR-P12: Total float (working days) = LS - ES ≡ LF - EF.
 *             Critical ⇔ totalFloat ≤ 0.
 *   - BR-P13: Multiple relationships between the same pair — ALL bounds apply
 *             in both passes (max in forward, min in backward).
 *   - BR-P14: Cycle detection runs BEFORE any date computation. On cycle, the
 *             engine returns {kind:"cycle"} with no dates.
 *   - BR-P15: A negative lag may push an activity's ES before project start
 *             (index < 1). Legal — compute and emit a warning. Never clamp.
 *   - BR-P16: Validation runs BEFORE compute. Violations → structured errors.
 */

import type {
  ActivityInput,
  ComputedActivity,
  NetworkInput,
  RelationshipInput,
  ScheduleResult,
  ScheduleValidationError,
  ScheduleWarning,
} from "@shared/schemas/scheduling/network";
import type { RelationshipType } from "@shared/schemas/scheduling/network";
import {
  indexToDate,
  isWorking,
  parseIsoDate,
  validateCalendar,
} from "@domain/scheduling/calendar";
import { detectCycle, topologicalSort } from "@domain/scheduling/cycle-detection";

// ─── Helpers ────────────────────────────────────────────────────────────────

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Duration span = number of working-day "slots" an activity occupies.
 * For dur > 0: span = dur - 1 (e.g. a 3-day activity spans ES, ES+1, ES+2 → EF = ES+2).
 * For dur = 0 (milestone): span = 0 (ES = EF).
 *
 * BR-P10 says "EF(a) = ES(a) + dur(a) − 1 (duration 0 → EF = ES)". The parenthetical
 * overrides the formula when dur=0; this helper expresses that cleanly.
 */
function durationSpan(dur: number): number {
  return dur > 0 ? dur - 1 : 0;
}

interface ForwardBounds {
  es: number;
  ef: number;
}
interface BackwardBounds {
  ls: number;
  lf: number;
}

// ─── Validation (BR-P16) ───────────────────────────────────────────────────

/**
 * Validate a network input per BR-P16.
 *
 * Checks: project-start format, calendar validity, duplicate activity IDs,
 * duration is a non-negative integer (defensive — zod already enforces),
 * lag is an integer (defensive), relationship references resolve, no
 * self-relationships.
 *
 * @returns array of structured validation errors. Empty array = valid.
 */
export function validateNetwork(input: NetworkInput): ScheduleValidationError[] {
  const errors: ScheduleValidationError[] = [];

  // Project start format / validity (BR-P1).
  if (!ISO_DATE_RE.test(input.projectStart)) {
    errors.push({
      code: "INVALID_PROJECT_START",
      message: `projectStart must be ISO yyyy-MM-dd (got "${input.projectStart}")`,
    });
  } else {
    try {
      parseIsoDate(input.projectStart);
    } catch {
      errors.push({
        code: "INVALID_PROJECT_START",
        message: `projectStart is not a valid calendar date: "${input.projectStart}"`,
      });
    }
  }

  // Calendar validity (BR-P6 delegated to validateCalendar).
  for (const msg of validateCalendar(input.calendar)) {
    errors.push({ code: "INVALID_CALENDAR", message: msg });
  }

  // Activity IDs unique.
  const seenIds = new Set<string>();
  for (const a of input.activities) {
    if (seenIds.has(a.id)) {
      errors.push({
        code: "DUPLICATE_ACTIVITY_ID",
        message: `Duplicate activity id: "${a.id}"`,
        activityId: a.id,
      });
    }
    seenIds.add(a.id);
    if (!Number.isInteger(a.duration) || a.duration < 0) {
      errors.push({
        code: "INVALID_DURATION",
        message: `Activity "${a.code || a.id}" duration must be a non-negative integer (got ${a.duration})`,
        activityId: a.id,
      });
    }
  }

  // Relationship references + self-relationships + lag integer.
  const ids = new Set(input.activities.map((a) => a.id));
  for (let i = 0; i < input.relationships.length; i++) {
    const r = input.relationships[i];
    if (!ids.has(r.predecessorId)) {
      errors.push({
        code: "UNKNOWN_PREDECESSOR",
        message: `Relationship ${i}: predecessor "${r.predecessorId}" does not exist`,
        relationshipIndex: i,
      });
    }
    if (!ids.has(r.successorId)) {
      errors.push({
        code: "UNKNOWN_SUCCESSOR",
        message: `Relationship ${i}: successor "${r.successorId}" does not exist`,
        relationshipIndex: i,
      });
    }
    if (r.predecessorId === r.successorId) {
      errors.push({
        code: "SELF_RELATIONSHIP",
        message: `Relationship ${i}: self-relationship on "${r.predecessorId}"`,
        relationshipIndex: i,
      });
    }
    if (!Number.isInteger(r.lag)) {
      errors.push({
        code: "INVALID_LAG",
        message: `Relationship ${i}: lag must be an integer (got ${r.lag})`,
        relationshipIndex: i,
      });
    }
  }

  return errors;
}

// ─── Forward pass (BR-P10) ───────────────────────────────────────────────────

/**
 * Compute the forward ES/EF bounds (in working-day index space) for every
 * activity, processing in topological order.
 *
 * Open-start activities (no predecessors) get ES = 1 (BR-P8 — first working
 * day ≥ projectStart). Otherwise ES = max over relationship bounds.
 */
function forwardPass(
  activities: ActivityInput[],
  relationships: RelationshipInput[],
  topoOrder: string[],
): Map<string, ForwardBounds> {
  const activityById = new Map(activities.map((a) => [a.id, a] as const));

  // Build successor-side adjacency: succId → list of (predId, type, lag).
  const predsOf = new Map<string, Array<{ predId: string; type: RelationshipType; lag: number }>>();
  for (const a of activities) predsOf.set(a.id, []);
  for (const r of relationships) {
    const list = predsOf.get(r.successorId);
    if (list) list.push({ predId: r.predecessorId, type: r.type, lag: r.lag });
  }

  const es = new Map<string, number>();
  const ef = new Map<string, number>();

  for (const id of topoOrder) {
    const act = activityById.get(id)!;
    const span = durationSpan(act.duration);
    const preds = predsOf.get(id) ?? [];

    let esVal: number;
    if (preds.length === 0) {
      esVal = 1; // BR-P8
    } else {
      esVal = Number.NEGATIVE_INFINITY;
      for (const p of preds) {
        const pEs = es.get(p.predId)!;
        const pEf = ef.get(p.predId)!;
        const bound = forwardBoundForES(p.type, pEs, pEf, p.lag, act.duration);
        if (bound > esVal) esVal = bound;
      }
    }
    es.set(id, esVal);
    ef.set(id, esVal + span);
  }

  const result = new Map<string, ForwardBounds>();
  for (const id of topoOrder) {
    result.set(id, { es: es.get(id)!, ef: ef.get(id)! });
  }
  return result;
}

/**
 * Forward bound: ES(successor) lower-bound from a single relationship.
 * See file header for the four case formulas.
 */
function forwardBoundForES(
  type: RelationshipType,
  pEs: number,
  pEf: number,
  lag: number,
  succDur: number,
): number {
  const succSpan = durationSpan(succDur);
  switch (type) {
    case "FS": return pEf + 1 + lag;
    case "SS": return pEs + lag;
    case "FF": return pEf + lag - succSpan;
    case "SF": return pEs + lag - succSpan;
    default: {
      const _exhaustive: never = type;
      throw new Error(`Unknown relationship type: ${_exhaustive as string}`);
    }
  }
}

// ─── Backward pass (BR-P11) ─────────────────────────────────────────────────

/**
 * Compute the backward LS/LF bounds (in working-day index space) for every
 * activity, processing in REVERSE topological order.
 *
 * Project finish = max EF. For no-successor: LF = project finish.
 * Otherwise: LF = min over relationship bounds. Then LS = LF - durationSpan.
 */
function backwardPass(
  activities: ActivityInput[],
  relationships: RelationshipInput[],
  topoOrder: string[],
  forward: Map<string, ForwardBounds>,
): Map<string, BackwardBounds> {
  if (activities.length === 0) return new Map();

  const activityById = new Map(activities.map((a) => [a.id, a] as const));

  // Build predecessor-side adjacency: predId → list of (succId, type, lag).
  const succsOf = new Map<string, Array<{ succId: string; type: RelationshipType; lag: number }>>();
  for (const a of activities) succsOf.set(a.id, []);
  for (const r of relationships) {
    const list = succsOf.get(r.predecessorId);
    if (list) list.push({ succId: r.successorId, type: r.type, lag: r.lag });
  }

  // Project finish = max EF (BR-P11).
  let projectFinish = Number.NEGATIVE_INFINITY;
  for (const [, v] of forward) {
    if (v.ef > projectFinish) projectFinish = v.ef;
  }

  const ls = new Map<string, number>();
  const lf = new Map<string, number>();

  // Reverse topological order.
  for (let i = topoOrder.length - 1; i >= 0; i--) {
    const id = topoOrder[i];
    const act = activityById.get(id)!;
    const span = durationSpan(act.duration);
    const succs = succsOf.get(id) ?? [];

    let lfVal: number;
    if (succs.length === 0) {
      lfVal = projectFinish;
    } else {
      lfVal = Number.POSITIVE_INFINITY;
      for (const s of succs) {
        const sLs = ls.get(s.succId)!;
        const sLf = lf.get(s.succId)!;
        const bound = backwardBoundForLF(s.type, sLs, sLf, s.lag, span);
        if (bound < lfVal) lfVal = bound;
      }
    }
    lf.set(id, lfVal);
    ls.set(id, lfVal - span);
  }

  const result = new Map<string, BackwardBounds>();
  for (const id of topoOrder) {
    result.set(id, { ls: ls.get(id)!, lf: lf.get(id)! });
  }
  return result;
}

/**
 * Backward bound: LF(predecessor) upper-bound from a single relationship.
 * See file header for the four case formulas.
 */
function backwardBoundForLF(
  type: RelationshipType,
  sLs: number,
  sLf: number,
  lag: number,
  predSpan: number,
): number {
  switch (type) {
    case "FS": return sLs - 1 - lag;
    case "FF": return sLf - lag;
    case "SS": return sLs - lag + predSpan;
    case "SF": return sLf - lag + predSpan;
    default: {
      const _exhaustive: never = type;
      throw new Error(`Unknown relationship type: ${_exhaustive as string}`);
    }
  }
}

// ─── Critical path (BR-P12) ─────────────────────────────────────────────────

/**
 * A relationship is "tight" if its bound equals the actual computed value —
 * i.e. it drives the schedule (removing it would change the dates, or it
 * connects two critical activities without slack).
 *
 * For each (pred, succ, type, lag), tightness is checked against the forward
 * pass values (ES/EF).
 */
function isRelationshipTight(
  type: RelationshipType,
  pEs: number,
  pEf: number,
  sEs: number,
  sEf: number,
  lag: number,
): boolean {
  switch (type) {
    case "FS": return sEs === pEf + 1 + lag;
    case "SS": return sEs === pEs + lag;
    case "FF": return sEf === pEf + lag;
    case "SF": return sEf === pEs + lag;
    default: return false;
  }
}

/**
 * Compute the critical path: the longest chain of critical activities
 * connected by tight relationships.
 *
 * Algorithm:
 *   1. Compute total float (TF = LS - ES) for every activity.
 *   2. Mark an activity as critical iff TF ≤ 0 (BR-P12).
 *   3. Build the subgraph of tight edges among critical activities.
 *   4. Find the longest path (in activity-count, not duration) in this DAG
 *      via DP over the topological order.
 *
 * @returns the activity IDs in chain order (predecessor first).
 */
function computeCriticalPath(
  activities: ActivityInput[],
  relationships: RelationshipInput[],
  forward: Map<string, ForwardBounds>,
  backward: Map<string, BackwardBounds>,
  topoOrder: string[],
): string[] {
  // 1. Total float
  const tf = new Map<string, number>();
  for (const a of activities) {
    const f = forward.get(a.id)!;
    const b = backward.get(a.id)!;
    tf.set(a.id, b.ls - f.es);
  }
  const isCritical = (id: string): boolean => (tf.get(id) ?? 0) <= 0;

  // 3. Reverse adjacency: succId → [predId, ...] restricted to tight edges
  //    between two critical activities.
  const revAdj = new Map<string, string[]>();
  for (const a of activities) revAdj.set(a.id, []);
  for (const r of relationships) {
    if (!isCritical(r.predecessorId) || !isCritical(r.successorId)) continue;
    const pEs = forward.get(r.predecessorId)!.es;
    const pEf = forward.get(r.predecessorId)!.ef;
    const sEs = forward.get(r.successorId)!.es;
    const sEf = forward.get(r.successorId)!.ef;
    if (isRelationshipTight(r.type, pEs, pEf, sEs, sEf, r.lag)) {
      revAdj.get(r.successorId)!.push(r.predecessorId);
    }
  }

  // 4. Longest path via DP over critical-only topo order.
  const criticalTopo = topoOrder.filter(isCritical);
  const longestPathEndingAt = new Map<string, string[]>();
  let bestPath: string[] = [];

  for (const id of criticalTopo) {
    let bestPredPath: string[] = [];
    for (const predId of revAdj.get(id) ?? []) {
      const predPath = longestPathEndingAt.get(predId) ?? [];
      if (predPath.length > bestPredPath.length) {
        bestPredPath = predPath;
      }
    }
    const myPath = [...bestPredPath, id];
    longestPathEndingAt.set(id, myPath);
    if (myPath.length > bestPath.length) bestPath = myPath;
  }

  return bestPath;
}

// ─── Main entry point ─────────────────────────────────────────────────────

/**
 * Compute a schedule from a CPM network input.
 *
 * Pipeline (BR-P14, BR-P16 run BEFORE any date computation):
 *   1. validateNetwork (BR-P16) → on violations, return {kind:"validation"}.
 *   2. detectCycle (BR-P14) → on cycle, return {kind:"cycle"}.
 *   3. topologicalSort.
 *   4. forwardPass (BR-P10) → ES/EF in index space.
 *   5. backwardPass (BR-P11) → LS/LF in index space.
 *   6. computeCriticalPath (BR-P12).
 *   7. Convert indices to ISO dates via the calendar (boundary).
 *   8. Emit warnings for ES-before-project-start (BR-P15).
 *
 * @returns discriminated union by `kind`. See ScheduleResult.
 */
export function computeSchedule(input: NetworkInput): ScheduleResult {
  // 1. Validate (BR-P16).
  const errors = validateNetwork(input);
  if (errors.length > 0) {
    return { kind: "validation", errors };
  }

  // 2. Cycle detection (BR-P14) — BEFORE any date work.
  const cycle = detectCycle(input.activities, input.relationships);
  if (cycle) {
    return { kind: "cycle", cycleActivityIds: cycle };
  }

  // 3. Topological sort (no cycle by step 2).
  const topoOrder = topologicalSort(input.activities, input.relationships);

  // 4. Forward pass (BR-P10).
  const forward = forwardPass(input.activities, input.relationships, topoOrder);

  // 5. Backward pass (BR-P11).
  const backward = backwardPass(
    input.activities,
    input.relationships,
    topoOrder,
    forward,
  );

  // 6. Project finish = max EF.
  let projectFinishIndex = Number.NEGATIVE_INFINITY;
  for (const [, v] of forward) {
    if (v.ef > projectFinishIndex) projectFinishIndex = v.ef;
  }

  // 7. Critical path (BR-P12).
  const criticalPath = computeCriticalPath(
    input.activities,
    input.relationships,
    forward,
    backward,
    topoOrder,
  );

  // 8. Convert to ComputedActivity[] (index → ISO date at the calendar boundary).
  const activities: ComputedActivity[] = input.activities.map((a) => {
    const f = forward.get(a.id)!;
    const b = backward.get(a.id)!;
    const tf = b.ls - f.es;
    return {
      id: a.id,
      code: a.code,
      duration: a.duration,
      type: a.type ?? "TASK",
      esIndex: f.es,
      efIndex: f.ef,
      lsIndex: b.ls,
      lfIndex: b.lf,
      es: indexToDate(input.calendar, input.projectStart, f.es),
      ef: indexToDate(input.calendar, input.projectStart, f.ef),
      ls: indexToDate(input.calendar, input.projectStart, b.ls),
      lf: indexToDate(input.calendar, input.projectStart, b.lf),
      totalFloat: tf,
      isCritical: tf <= 0,
    };
  });

  // 9. Warnings (BR-P15) — negative lag may push ES before project start.
  const warnings: ScheduleWarning[] = [];
  for (const a of activities) {
    if (a.esIndex < 1) {
      warnings.push({
        code: "ES_BEFORE_PROJECT_START",
        message:
          `Activity "${a.code}" (id="${a.id}") has ES index ${a.esIndex} < 1 ` +
          `(negative lag pushed it before project start).`,
        activityId: a.id,
      });
    }
  }

  // 10. Project finish date (empty-network edge case → projectStart).
  const projectFinishDate =
    activities.length === 0
      ? input.projectStart
      : indexToDate(input.calendar, input.projectStart, projectFinishIndex);

  return {
    kind: "success",
    activities,
    projectFinishDate,
    projectFinishIndex,
    criticalPath,
    warnings,
  };
}
