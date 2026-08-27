/**
 * Document Control — Numbering (BR-DC2, BR-DC3).
 *
 * Pure functions for sequential ref generation. Per BR-DC2:
 *   - Submittals: SUB-### (zero-padded width 3, e.g. SUB-001)
 *   - RFIs: RFI-###
 *   - Correspondence: IN-### (incoming) / OUT-### (outgoing)
 *   - Drawing codes: engineer-assigned, NOT auto-generated here.
 *
 * Numbering is sequential + monotonic + NEVER reused. Soft-deleted refs are
 * still counted toward the high-water mark — i.e. the next ref is
 * `max(all_live_refs ∪ all_soft_deleted_refs) + 1`. This guarantees that a
 * ref can never be reissued even after a deletion (BR-DC3 / GT-DC3 law).
 *
 * Per CONSTITUTION_V1.1_WEB §3.3 — this file is isomorphic:
 *   - Imports only @shared/* (no platform code).
 *   - MUST NOT import next, react, prisma, fs, path, electron, etc.
 *   - No Date.now(), no Math.random(), no I/O.
 *
 * Law (golden tests are authoritative — tests/golden/gt-dc3-numbering-retired.test.ts):
 *   - max-ever-issued + 1 (soft-deleted counts) — GT-DC3.
 */

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Extract the numeric suffix from a ref like "SUB-001" → 1.
 *
 * Strict: the portion after `PREFIX-` must be all ASCII digits. Any non-digit
 * character (letter, space, hyphen) makes the ref ineligible — returns null.
 *
 * Refs without the expected prefix also return null (e.g. trying to extract
 * SUB-### from "RFI-001" returns null).
 *
 * @internal
 */
function extractSeq(ref: string, prefix: string): number | null {
  const expectedPrefix = `${prefix}-`;
  if (!ref.startsWith(expectedPrefix)) return null;
  const rest = ref.slice(expectedPrefix.length);
  if (rest.length === 0) return null;
  // Must be all digits — guard against "SUB-001A" or "SUB--1" etc.
  if (!/^\d+$/.test(rest)) return null;
  const n = parseInt(rest, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * Format a ref: `formatRef("SUB", 4)` → "SUB-004" (zero-padded to width 3).
 *
 * Width 3 matches the spec's "###" placeholder. Numbers ≥ 1000 simply render
 * with no extra padding (SUB-1000), preserving monotonic sortability under
 * string comparison up to 999.
 *
 * @internal
 */
function formatRef(prefix: string, seq: number, width: number = 3): string {
  const str = String(seq);
  const padded = str.length >= width ? str : str.padStart(width, "0");
  return `${prefix}-${padded}`;
}

/**
 * Maximum sequence number across both live + soft-deleted ref lists.
 *
 * Returns 0 if neither list contains a valid ref matching `prefix`. Callers
 * then add 1 to get the next available ref (BR-DC2 monotonic property).
 *
 * @internal
 */
function maxSeq(prefix: string, existingRefs: string[], deletedRefs: string[]): number {
  let max = 0;
  for (const ref of existingRefs) {
    const n = extractSeq(ref, prefix);
    if (n !== null && n > max) max = n;
  }
  for (const ref of deletedRefs) {
    const n = extractSeq(ref, prefix);
    if (n !== null && n > max) max = n;
  }
  return max;
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Next submittal ref. Format: `SUB-###` (e.g. SUB-001, SUB-002, ..., SUB-999,
 * SUB-1000, ...).
 *
 * Per BR-DC2 + GT-DC3: the high-water mark includes soft-deleted refs. If
 * SUB-001, SUB-002, SUB-003 exist and SUB-002 is soft-deleted, the next ref
 * is SUB-004 (002 stays retired — never reused).
 */
export function nextSubmittalRef(
  existingRefs: string[],
  deletedRefs: string[],
): string {
  return formatRef("SUB", maxSeq("SUB", existingRefs, deletedRefs) + 1);
}

/**
 * Next RFI ref. Format: `RFI-###`.
 *
 * Same monotonic + soft-delete-aware rule as submittals (BR-DC2).
 */
export function nextRfiRef(
  existingRefs: string[],
  deletedRefs: string[],
): string {
  return formatRef("RFI", maxSeq("RFI", existingRefs, deletedRefs) + 1);
}

/**
 * Next correspondence ref. Format depends on direction:
 *   - INCOMING → `IN-###`
 *   - OUTGOING → `OUT-###`
 *
 * Incoming and outgoing sequences are INDEPENDENT (BR-DC2 — IN-001 and OUT-001
 * can both exist without conflict). Soft-deleted refs count toward the
 * high-water mark in each direction's own sequence.
 */
export function nextCorrespondenceRef(
  direction: "INCOMING" | "OUTGOING",
  existingRefs: string[],
  deletedRefs: string[],
): string {
  const prefix = direction === "INCOMING" ? "IN" : "OUT";
  return formatRef(prefix, maxSeq(prefix, existingRefs, deletedRefs) + 1);
}

/**
 * Next revision letter in the A, B, ..., Z, AA, AB, ..., AZ, BA, ..., ZZ, AAA
 * series (bijective base-26).
 *
 * Examples:
 *   - null / ""      → "A"     (first revision)
 *   - "A"            → "B"
 *   - "Y"            → "Z"
 *   - "Z"            → "AA"
 *   - "AA"           → "AB"
 *   - "AZ"           → "BA"
 *   - "ZZ"           → "AAA"
 *
 * Per BR-DC3: revision series default is A, B, C…; new revision requires an
 * attached file; adding rev N+1 auto-supersedes the current revision.
 *
 * Case-insensitive on input; output is always upper-case.
 */
export function nextRevisionLetter(currentRevision: string | null): string {
  if (currentRevision === null || currentRevision === "") {
    return "A";
  }
  return incrementBijectiveBase26(currentRevision.toUpperCase());
}

/**
 * Increment a bijective base-26 string (where A=1, B=2, ..., Z=26, AA=27, ...).
 *
 * Walk from the right; carry on Z. If every char was Z, prepend a new A.
 *
 * @internal
 */
function incrementBijectiveBase26(s: string): string {
  // Validate input — must be 1+ uppercase ASCII letters.
  if (!/^[A-Z]+$/.test(s)) {
    // Defensive fallback: treat as if previous was "A" → next "B".
    // This shouldn't happen if callers pass real revision letters.
    return "B";
  }
  const chars = s.split("");
  let i = chars.length - 1;
  while (i >= 0) {
    if (chars[i] === "Z") {
      chars[i] = "A";
      i--;
      continue;
    }
    chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1);
    return chars.join("");
  }
  // All chars were Z — carry past the left edge → prepend A.
  return "A" + chars.join("");
}
