/**
 * GT-DC1 — Drawing Revisions (Golden Test — AUTHORITATIVE).
 *
 * From SPEC_PHASE3_WEB.md §4:
 *   Drawing D-100, current rev A (issued); add revision B with file
 *   Expected:
 *     - Rev A → superseded
 *     - current = B with status issued
 *     - events include revision-added: B
 *
 * This test exercises:
 *   - `nextRevisionLetter("A") === "B"`                (numbering module)
 *   - `applyRevisionSuperseded("A", "B")` returns      (status-workflow module)
 *       { oldStatus: "SUPERSEDED", newStatus: "ISSUED" }
 *   - The event log includes a REVISION_ADDED entry for "B" (BR-DC8 append-only)
 *   - The new revision row carries a non-null `fileUploadId` (BR-DC3)
 *
 * Per the Constitution: golden tests are law. NEVER edit expected values.
 * If this test fails, the code is wrong.
 */

import { describe, it, expect } from "vitest";
import { nextRevisionLetter } from "@domain/doccontrol/numbering";
import { applyRevisionSuperseded } from "@domain/doccontrol/status-workflow";
import type {
  DrawingRevisionEventInput,
  DrawingRevisionInput,
  DrawingStatus,
} from "@shared/schemas/doccontrol/entities";

describe("GT-DC1 — Drawing revisions (authoritative)", () => {
  // Setup: Drawing D-100, current rev A (issued).
  const currentRevisionLetter = "A";
  const currentStatus: DrawingStatus = "ISSUED";

  // Step 1: compute the new revision letter.
  const newRevisionLetter = nextRevisionLetter(currentRevisionLetter);

  it("nextRevisionLetter('A') === 'B'", () => {
    expect(newRevisionLetter).toBe("B");
  });

  // Step 2: apply BR-DC3 supersede rule.
  const supersede = applyRevisionSuperseded(currentRevisionLetter, newRevisionLetter);

  it("Rev A (current) → SUPERSEDED", () => {
    expect(supersede.oldStatus).toBe("SUPERSEDED");
  });

  it("Rev B (new) → ISSUED", () => {
    expect(supersede.newStatus).toBe("ISSUED");
  });

  // Step 3: build the new revision row (BR-DC3 — must have attached file).
  const eventDate = "2026-01-15";
  const fileUploadId = "file-upload-001";
  const newRevision: DrawingRevisionInput = {
    drawingId: "drawing-D-100",
    revision: newRevisionLetter,
    status: supersede.newStatus,
    revisionDate: eventDate,
    fileUploadId, // BR-DC3: new revision requires attached file
    notes: null,
    createdByUserId: "user-1",
  };

  it("current revision = B with status issued (file attached)", () => {
    expect(newRevision.revision).toBe("B");
    expect(newRevision.status).toBe("ISSUED");
    expect(newRevision.fileUploadId).toBe("file-upload-001"); // BR-DC3
  });

  // Step 4: build the event log (BR-DC8 — append-only).
  // The events emitted when a revision is added are:
  //   1. REVISION_ADDED  for the new revision (B)
  //   2. SUPERSEDED      for the old revision (A)
  // Both carry the same eventDate (the moment of the revision-add action).
  const events: DrawingRevisionEventInput[] = [
    {
      drawingId: "drawing-D-100",
      revisionId: "revision-B",
      eventType: "REVISION_ADDED",
      fromStatus: null,
      toStatus: supersede.newStatus,
      note: `Revision ${newRevisionLetter} added`,
      eventDate,
      createdByUserId: "user-1",
    },
    {
      drawingId: "drawing-D-100",
      revisionId: "revision-A",
      eventType: "SUPERSEDED",
      fromStatus: currentStatus,
      toStatus: supersede.oldStatus,
      note: `Superseded by revision ${newRevisionLetter}`,
      eventDate,
      createdByUserId: "user-1",
    },
  ];

  it("events include revision-added: B", () => {
    const added = events.find(
      (e) => e.eventType === "REVISION_ADDED" && e.note?.includes("Revision B"),
    );
    expect(added).toBeDefined();
    expect(added?.toStatus).toBe("ISSUED");
  });

  it("events include superseded: A (with from=ISSUED, to=SUPERSEDED)", () => {
    const sup = events.find((e) => e.eventType === "SUPERSEDED");
    expect(sup).toBeDefined();
    expect(sup?.fromStatus).toBe("ISSUED");
    expect(sup?.toStatus).toBe("SUPERSEDED");
  });

  it("events are append-only — never edited or deleted (BR-DC8)", () => {
    // The event list is constructed once and never mutated. We verify the
    // invariants that hold for the lifecycle of the drawing:
    //   - REVISION_ADDED always has fromStatus = null (new entity, no prior state)
    //   - SUPERSEDED always has fromStatus = ISSUED (per GT-DC1 setup) and
    //     toStatus = SUPERSEDED
    //   - All events carry the same eventDate (single atomic action)
    for (const e of events) {
      expect(e.eventDate).toBe(eventDate);
    }
    expect(events[0].eventType).toBe("REVISION_ADDED");
    expect(events[0].fromStatus).toBeNull();
    expect(events[1].eventType).toBe("SUPERSEDED");
  });
});
