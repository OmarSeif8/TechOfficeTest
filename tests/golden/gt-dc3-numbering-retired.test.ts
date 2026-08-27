/**
 * GT-DC3 — Numbering Retired (Golden Test — AUTHORITATIVE).
 *
 * From SPEC_PHASE3_WEB.md §4:
 *   Create SUB-001..003; soft-delete SUB-002; create next
 *   Expected: Next ref = SUB-004 (002 retired)
 *
 * This test exercises:
 *   - `nextSubmittalRef(existingRefs, deletedRefs)` honors the high-water
 *     mark ACROSS live + soft-deleted refs (BR-DC2 monotonic, never reused).
 *
 * Per the Constitution: golden tests are law. NEVER edit expected values.
 * If this test fails, the code is wrong.
 */

import { describe, it, expect } from "vitest";
import {
  nextCorrespondenceRef,
  nextRfiRef,
  nextSubmittalRef,
} from "@domain/doccontrol/numbering";

describe("GT-DC3 — Numbering retired (authoritative)", () => {
  it("next submittal ref after SUB-001..003 with SUB-002 soft-deleted = SUB-004", () => {
    // SUB-001, SUB-003 are live; SUB-002 was soft-deleted.
    // max-ever-issued = 3 → next = 4 → SUB-004.
    const existing = ["SUB-001", "SUB-003"];
    const deleted = ["SUB-002"];
    const next = nextSubmittalRef(existing, deleted);
    expect(next).toBe("SUB-004");
  });

  it("next submittal ref with no soft-deletes = max + 1 (sanity)", () => {
    const existing = ["SUB-001", "SUB-002", "SUB-003"];
    const deleted: string[] = [];
    expect(nextSubmittalRef(existing, deleted)).toBe("SUB-004");
  });

  it("next submittal ref from empty = SUB-001 (first)", () => {
    expect(nextSubmittalRef([], [])).toBe("SUB-001");
  });

  it("soft-deleted high-water mark is honored even if it exceeds live max", () => {
    // Edge case: SUB-005 deleted, only SUB-001..003 live → next = SUB-006.
    const existing = ["SUB-001", "SUB-002", "SUB-003"];
    const deleted = ["SUB-005"];
    expect(nextSubmittalRef(existing, deleted)).toBe("SUB-006");
  });

  it("RFI numbering follows the same rule (BR-DC2 — RFI-### never reused)", () => {
    const existing = ["RFI-001", "RFI-003"];
    const deleted = ["RFI-002"];
    expect(nextRfiRef(existing, deleted)).toBe("RFI-004");
  });

  it("Correspondence numbering is direction-prefixed (IN-### vs OUT-###)", () => {
    // IN and OUT are independent sequences (BR-DC2).
    const existingIn = ["IN-001", "IN-002"];
    const deletedIn = ["IN-003"];
    expect(nextCorrespondenceRef("INCOMING", existingIn, deletedIn)).toBe(
      "IN-004",
    );

    const existingOut = ["OUT-001"];
    const deletedOut: string[] = [];
    expect(nextCorrespondenceRef("OUTGOING", existingOut, deletedOut)).toBe(
      "OUT-002",
    );

    // IN-### and OUT-### sequences don't interfere — even if OUT has 9 items
    // and IN has 1, the next IN ref is IN-002 (not IN-011).
    expect(nextCorrespondenceRef("INCOMING", ["IN-001"], [])).toBe("IN-002");
    expect(
      nextCorrespondenceRef("OUTGOING", Array.from({ length: 9 }, (_, i) => `OUT-${String(i + 1).padStart(3, "0")}`), []),
    ).toBe("OUT-010");
  });

  it("malformed refs are ignored (not counted toward high-water)", () => {
    // "SUB-ABC" is not a valid SUB-### ref — the numbering domain skips it
    // rather than crashing.
    const existing = ["SUB-001", "SUB-ABC", "SUB-003"];
    const deleted = ["SUB-002"];
    expect(nextSubmittalRef(existing, deleted)).toBe("SUB-004");
  });
});
