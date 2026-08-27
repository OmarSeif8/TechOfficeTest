/**
 * Document Control — zod schemas for all Phase 3A doc-control entities.
 *
 * Lives in src/shared/schemas/doccontrol/ (lowest layer).
 * Per CONSTITUTION_V1.1_WEB §3.3 — this file MUST NOT import next, react, prisma,
 * fs, path, electron, etc. Only `zod` and other `@shared/*` self-references.
 *
 * Implements the wire + persistence input shape for the Phase 3 doc-control
 * domain (drawings, submittals, RFIs, correspondence, transmittals).
 *
 * Per BR-DC1: every date-dependent domain function receives the current date as
 * an `asOf` parameter — `Date.now()` / `new Date()` are forbidden in
 * `src/domain/`. All `date`-shaped fields here are ISO `yyyy-MM-dd` strings.
 *
 * Per BR-DC2: submittal refs are `SUB-###`, RFI refs are `RFI-###`,
 * correspondence refs are `IN-###` or `OUT-###` (engineer-assigned at creation
 * via the numbering domain). Drawing codes are engineer-assigned, unique per
 * project, and NOT auto-generated.
 *
 * Per BR-DC3: every DrawingRevision must have an attached file (fileUploadId).
 * Per BR-DC6: reviewPeriodDays is in CALENDAR days (not working days).
 * Per BR-DC8: status changes are append-only events (declared as Input shapes
 * here; the actual event row is constructed by the workflow domain module).
 */

import { z } from "zod";

// ─── Shared primitives ───────────────────────────────────────────────────

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = z.string().regex(ISO_DATE_RE, "expected ISO yyyy-MM-dd");

// ─── Enum schemas ────────────────────────────────────────────────────────
//
// These mirror the Prisma enums (which are stored as TEXT in SQLite) AND the
// plain TS union types declared in `src/shared/entities.ts`. The two must
// stay in sync — the Prisma schema is the source of truth for the DB shape;
// the zod schema is the source of truth for the wire shape; the plain TS
// type is the source of truth for the entity interface. All three must match.

/** Engineering discipline for a drawing, submittal, or RFI. */
export const DisciplineSchema = z.enum([
  "ARC", // Architectural
  "STR", // Structural
  "CIV", // Civil
  "MEC", // Mechanical
  "ELE", // Electrical
  "PLB", // Plumbing
  "FIR", // Fire-fighting
  "LND", // Landscape
]);
export type Discipline = z.infer<typeof DisciplineSchema>;

/** Drawing revision status (BR-DC4). */
export const DrawingStatusSchema = z.enum([
  "PRELIMINARY",
  "ISSUED",
  "APPROVED_FOR_CONSTRUCTION",
  "SUPERSEDED", // terminal — newer revision exists
  "OBSOLETE", // terminal — drawing withdrawn
]);
export type DrawingStatus = z.infer<typeof DrawingStatusSchema>;

/** Submittal workflow status (BR-DC5). */
export const SubmittalStatusSchema = z.enum([
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "APPROVED",
  "APPROVED_WITH_COMMENTS",
  "REJECTED",
  "REVISE_RESUBMIT",
]);
export type SubmittalStatus = z.infer<typeof SubmittalStatusSchema>;

/** Submittal type. */
export const SubmittalTypeSchema = z.enum(["MATERIAL", "TECHNICAL"]);
export type SubmittalType = z.infer<typeof SubmittalTypeSchema>;

/** RFI workflow status (BR-DC7). */
export const RfiStatusSchema = z.enum([
  "OPEN",
  "ANSWERED",
  "CLOSED",
  "CANCELLED", // terminal
]);
export type RfiStatus = z.infer<typeof RfiStatusSchema>;

/** Correspondence direction (BR-DC2). */
export const CorrespondenceDirectionSchema = z.enum(["INCOMING", "OUTGOING"]);
export type CorrespondenceDirection = z.infer<
  typeof CorrespondenceDirectionSchema
>;

/** Correspondence type. TRANSMITTAL triggers the transmittal-line builder. */
export const CorrespondenceTypeSchema = z.enum([
  "LETTER",
  "MEMO",
  "TRANSMITTAL",
  "EMAIL",
  "OTHER",
]);
export type CorrespondenceType = z.infer<typeof CorrespondenceTypeSchema>;

// ─── Entity input schemas ────────────────────────────────────────────────
//
// These describe the shape that the API routes accept on create/update and
// that the Prisma repository impls will persist. Read-shape (full entity
// with id/version/timestamps) lives in `src/shared/entities.ts`.

/**
 * Drawing — engineer-assigned code, unique per project (BR-DC2).
 *
 * The current revision is tracked via `currentRevisionId` on the persisted
 * row; this input shape only carries the drawing's own metadata. Revisions
 * are added via `DrawingRevisionInput`.
 */
export const DrawingInputSchema = z.object({
  id: z.string().optional(),
  projectId: z.string().min(1),
  code: z.string().min(1), // engineer-assigned, unique per project
  titleEn: z.string().min(1),
  titleAr: z.string().nullable().optional(),
  discipline: DisciplineSchema,
});
export type DrawingInput = z.infer<typeof DrawingInputSchema>;

/**
 * Drawing revision — one revision of a drawing.
 *
 * Per BR-DC3: a new revision REQUIRES an attached file (`fileUploadId`).
 * The `revision` string is the user-visible letter: "A", "B", ..., "Z", "AA".
 */
export const DrawingRevisionInputSchema = z.object({
  id: z.string().optional(),
  drawingId: z.string().min(1),
  revision: z.string().min(1), // "A", "B", "AA", ...
  status: DrawingStatusSchema,
  revisionDate: isoDate,
  fileUploadId: z.string().nullable().optional(), // BR-DC3: required on new revs
  notes: z.string().nullable().optional(),
  createdByUserId: z.string().min(1),
});
export type DrawingRevisionInput = z.infer<typeof DrawingRevisionInputSchema>;

/**
 * Drawing revision event — append-only log of revision lifecycle (BR-DC8).
 *
 * Event types:
 *   - REVISION_ADDED: new revision created
 *   - STATUS_CHANGED: status transitioned (e.g. PRELIMINARY → ISSUED)
 *   - SUPERSEDED: a newer revision was added; this revision auto-supersedes
 */
export const DrawingRevisionEventTypeSchema = z.enum([
  "REVISION_ADDED",
  "STATUS_CHANGED",
  "SUPERSEDED",
]);
export type DrawingRevisionEventType = z.infer<
  typeof DrawingRevisionEventTypeSchema
>;

export const DrawingRevisionEventInputSchema = z.object({
  id: z.string().optional(),
  drawingId: z.string().min(1),
  revisionId: z.string().min(1),
  eventType: DrawingRevisionEventTypeSchema,
  fromStatus: DrawingStatusSchema.nullable().optional(),
  toStatus: DrawingStatusSchema,
  note: z.string().nullable().optional(),
  eventDate: isoDate, // BR-DC1: injected by caller, NOT Date.now()
  createdByUserId: z.string().min(1),
});
export type DrawingRevisionEventInput = z.infer<
  typeof DrawingRevisionEventInputSchema
>;

/**
 * Submittal — material or technical submission requiring review.
 *
 * Per BR-DC6:
 *   - default review period = 14 calendar days
 *   - due date = submittedDate + reviewPeriodDays
 *   - overdue ⇔ asOf > dueDate AND status non-final AND status != DRAFT
 *
 * Per BR-DC5: status workflow
 *   draft → submitted → under-review →
 *     approved | approved-with-comments | rejected | revise-resubmit
 *
 * `resubmissionNo` increments on each REVISE_RESUBMIT cycle (0 = first submission).
 */
export const SubmittalInputSchema = z.object({
  id: z.string().optional(),
  projectId: z.string().min(1),
  ref: z.string().min(1), // "SUB-001" — assigned by numbering domain
  subjectEn: z.string().min(1),
  subjectAr: z.string().nullable().optional(),
  type: SubmittalTypeSchema,
  discipline: DisciplineSchema,
  submittedDate: isoDate.nullable().optional(),
  reviewPeriodDays: z.number().int().nonnegative().default(14), // BR-DC6 default
  resubmissionNo: z.number().int().nonnegative().default(0),
  status: SubmittalStatusSchema.default("DRAFT"),
});
export type SubmittalInput = z.infer<typeof SubmittalInputSchema>;

/** Submittal event — append-only workflow log (BR-DC8). */
export const SubmittalEventInputSchema = z.object({
  id: z.string().optional(),
  submittalId: z.string().min(1),
  fromStatus: SubmittalStatusSchema.nullable().optional(),
  toStatus: SubmittalStatusSchema,
  note: z.string().nullable().optional(),
  eventDate: isoDate, // BR-DC1: injected
  createdByUserId: z.string().min(1),
});
export type SubmittalEventInput = z.infer<typeof SubmittalEventInputSchema>;

/**
 * RFI — Request For Information.
 *
 * Per BR-DC6: default review period = 7 calendar days.
 * Per BR-DC7: open → answered → closed; cancelled terminal.
 *   Answering sets answer text (EN/AR) + answer date.
 */
export const RfiInputSchema = z.object({
  id: z.string().optional(),
  projectId: z.string().min(1),
  ref: z.string().min(1), // "RFI-001"
  questionEn: z.string().min(1),
  questionAr: z.string().nullable().optional(),
  linkedDrawingId: z.string().nullable().optional(),
  sentDate: isoDate.nullable().optional(),
  reviewPeriodDays: z.number().int().nonnegative().default(7), // BR-DC6 default
  answerEn: z.string().nullable().optional(),
  answerAr: z.string().nullable().optional(),
  answerDate: isoDate.nullable().optional(),
  status: RfiStatusSchema.default("OPEN"),
});
export type RfiInput = z.infer<typeof RfiInputSchema>;

/** RFI event — append-only workflow log (BR-DC8). */
export const RfiEventInputSchema = z.object({
  id: z.string().optional(),
  rfiId: z.string().min(1),
  fromStatus: RfiStatusSchema.nullable().optional(),
  toStatus: RfiStatusSchema,
  note: z.string().nullable().optional(),
  eventDate: isoDate, // BR-DC1: injected
  createdByUserId: z.string().min(1),
});
export type RfiEventInput = z.infer<typeof RfiEventInputSchema>;

/**
 * Correspondence — letters, memos, transmittals, emails, etc.
 *
 * Per BR-DC2: ref is "IN-###" or "OUT-###" (direction-prefixed).
 * Per BR-DC10: a correspondence with type=TRANSMITTAL has child TransmittalLines.
 */
export const CorrespondenceInputSchema = z.object({
  id: z.string().optional(),
  projectId: z.string().min(1),
  ref: z.string().min(1), // "IN-001" / "OUT-001"
  direction: CorrespondenceDirectionSchema,
  type: CorrespondenceTypeSchema,
  date: isoDate,
  subjectEn: z.string().min(1),
  subjectAr: z.string().nullable().optional(),
  fromParty: z.string(),
  toParty: z.string(),
  bodyEn: z.string().nullable().optional(),
  bodyAr: z.string().nullable().optional(),
});
export type CorrespondenceInput = z.infer<typeof CorrespondenceInputSchema>;

/**
 * Transmittal line — one document row within a transmittal (BR-DC10).
 *
 * The parent transmittal is a Correspondence row with type=TRANSMITTAL.
 * `copies` is a positive integer; the total appears on the transmittal form.
 */
export const TransmittalLineInputSchema = z.object({
  id: z.string().optional(),
  transmittalId: z.string().min(1), // FK to Correspondence.id
  docRef: z.string().min(1),
  descriptionEn: z.string().min(1),
  descriptionAr: z.string().nullable().optional(),
  copies: z.number().int().nonnegative().default(1),
  sortOrder: z.number().int().nonnegative().default(0),
});
export type TransmittalLineInput = z.infer<typeof TransmittalLineInputSchema>;
