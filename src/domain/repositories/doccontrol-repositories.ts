/**
 * Document Control repository interfaces — pure interfaces (no Prisma imports).
 *
 * Lives in src/domain/repositories/ (pure interface — no Prisma imports).
 * Implementations: src/infrastructure/persistence/prisma/doccontrol/*.ts (W3-4).
 *
 * Per CONSTITUTION_V1.1_WEB §3.3 — these are the contracts the API routes
 * (Group P) and future services use to talk to doc-control persistence.
 * Implementations live in the infrastructure layer; the domain never sees Prisma.
 *
 * Entity types come from @shared/entities (plain TS interfaces — no Prisma dep).
 * These plain types mirror the zod schemas in
 * `src/shared/schemas/doccontrol/entities.ts` (wire shape) and the Prisma
 * enums (DB shape, stored as TEXT in SQLite). All three must stay in sync.
 *
 * Layer purity:
 *   - This file imports only @shared/* (entities + doccontrol schemas).
 *   - It MUST NOT import next, react, prisma, fs, path, electron, etc.
 *
 * Conventions (mirrors scheduling-repositories.ts):
 *   - Read paths default to `deletedAt: null` (live only). Pass includeDeleted=true
 *     to also list tombstoned rows (the numbering domain reads both live + soft-
 *     deleted refs to honor BR-DC2 "never reused" — see nextSubmittalRef etc.).
 *   - Optimistic concurrency on Drawing/Submittal/Rfi/Correspondence via `version`.
 *   - Status events (DrawingRevisionEvent, SubmittalEvent, RfiEvent) are append-only
 *     — these interfaces only INSERT them, never update or delete.
 *   - DrawingRevision is append-only too — adding a new revision supersedes the
 *     current one (BR-DC3); the current revision's status is set to SUPERSEDED
 *     via the API route, which also writes a DrawingRevisionEvent.
 */

import type {
  Correspondence,
  CorrespondenceDirection,
  CorrespondenceType,
  Discipline,
  Drawing,
  DrawingRevision,
  DrawingRevisionEvent,
  DrawingStatus,
  Rfi,
  RfiEvent,
  RfiStatus,
  Submittal,
  SubmittalEvent,
  SubmittalStatus,
  SubmittalType,
  TransmittalLine,
} from "@shared/entities";

// ─── IDrawingRepository ──────────────────────────────────────────────────

export interface DrawingCreateInput {
  projectId: string;
  code: string; // engineer-assigned, unique per project (BR-DC2)
  titleEn: string;
  titleAr?: string | null;
  discipline: Discipline;
}

export interface DrawingUpdateInput {
  code?: string;
  titleEn?: string;
  titleAr?: string | null;
  discipline?: Discipline;
  /** Optimistic concurrency (BR-WEB-4). Must match the current version. */
  expectedVersion: number;
}

export type DrawingUpdateResult =
  | { kind: "ok"; drawing: Drawing }
  | { kind: "not_found" }
  | { kind: "conflict"; currentVersion: number };

export type DrawingDeleteResult =
  | { kind: "ok" }
  | { kind: "not_found" }
  | { kind: "conflict"; currentVersion: number };

export interface DrawingRevisionCreateInput {
  drawingId: string;
  revision: string; // "A", "B", ..., "Z", "AA", ...
  status: DrawingStatus;
  revisionDate: string; // ISO yyyy-MM-dd (BR-DC1)
  fileUploadId: string | null; // BR-DC3 — required on new revisions (enforced by API route)
  notes?: string | null;
  createdByUserId: string;
}

export interface DrawingRevisionEventCreateInput {
  drawingId: string;
  revisionId: string;
  eventType: "REVISION_ADDED" | "STATUS_CHANGED" | "SUPERSEDED";
  fromStatus?: DrawingStatus | null;
  toStatus: DrawingStatus;
  note?: string | null;
  eventDate: string; // ISO yyyy-MM-dd (BR-DC1)
  createdByUserId: string;
}

export interface IDrawingRepository {
  /** List drawings for a project (sorted by code asc), excluding soft-deleted by default. */
  list(projectId: string, includeDeleted?: boolean): Promise<Drawing[]>;
  getById(id: string, includeDeleted?: boolean): Promise<Drawing | null>;
  create(input: DrawingCreateInput): Promise<Drawing>;
  update(id: string, input: DrawingUpdateInput): Promise<DrawingUpdateResult>;
  softDelete(id: string, expectedVersion: number): Promise<DrawingDeleteResult>;

  /** Add a revision. Returns the new revision. Does NOT touch the parent drawing's
   *  `currentRevisionId` — that is the caller's responsibility (the API route).
   *  Likewise, superseding the previous revision is the caller's responsibility. */
  addRevision(input: DrawingRevisionCreateInput): Promise<DrawingRevision>;

  /** List revisions for a drawing (sorted by createdAt asc — A, B, C, ...). */
  listRevisions(drawingId: string): Promise<DrawingRevision[]>;

  /** List the append-only event log for a drawing (sorted by eventDate asc). */
  listEvents(drawingId: string): Promise<DrawingRevisionEvent[]>;

  /** Append a single event row (BR-DC8 — never edited or deleted). */
  addEvent(input: DrawingRevisionEventCreateInput): Promise<DrawingRevisionEvent>;

  /** Patch the `currentRevisionId` on a drawing (used after addRevision). */
  setCurrentRevision(drawingId: string, revisionId: string | null): Promise<void>;

  /** Update a revision's status (used when superseding the previous revision
   *  on addRevision — sets old status to SUPERSEDED per BR-DC3). */
  setRevisionStatus(revisionId: string, status: DrawingStatus): Promise<void>;
}

// ─── ISubmittalRepository ──────────────────────────────────────────────────

export interface SubmittalCreateInput {
  projectId: string;
  ref: string; // "SUB-001" — assigned by numbering domain (BR-DC2)
  subjectEn: string;
  subjectAr?: string | null;
  type: SubmittalType;
  discipline: Discipline;
  submittedDate?: string | null; // ISO yyyy-MM-dd (BR-DC1)
  reviewPeriodDays?: number; // default 14 (BR-DC6)
  resubmissionNo?: number; // default 0
  status?: SubmittalStatus; // default DRAFT
}

export interface SubmittalUpdateInput {
  subjectEn?: string;
  subjectAr?: string | null;
  type?: SubmittalType;
  discipline?: Discipline;
  submittedDate?: string | null;
  reviewPeriodDays?: number;
  resubmissionNo?: number;
  status?: SubmittalStatus;
  expectedVersion: number;
}

export type SubmittalUpdateResult =
  | { kind: "ok"; submittal: Submittal }
  | { kind: "not_found" }
  | { kind: "conflict"; currentVersion: number };

export type SubmittalDeleteResult =
  | { kind: "ok" }
  | { kind: "not_found" }
  | { kind: "conflict"; currentVersion: number };

export interface SubmittalEventCreateInput {
  submittalId: string;
  fromStatus?: SubmittalStatus | null;
  toStatus: SubmittalStatus;
  note?: string | null;
  eventDate: string; // ISO yyyy-MM-dd (BR-DC1)
  createdByUserId: string;
}

export interface ISubmittalRepository {
  list(projectId: string, includeDeleted?: boolean): Promise<Submittal[]>;
  getById(id: string, includeDeleted?: boolean): Promise<Submittal | null>;
  create(input: SubmittalCreateInput): Promise<Submittal>;
  update(id: string, input: SubmittalUpdateInput): Promise<SubmittalUpdateResult>;
  softDelete(id: string, expectedVersion: number): Promise<SubmittalDeleteResult>;
  addEvent(input: SubmittalEventCreateInput): Promise<SubmittalEvent>;
  listEvents(submittalId: string): Promise<SubmittalEvent[]>;
}

// ─── IRfiRepository ────────────────────────────────────────────────────────

export interface RfiCreateInput {
  projectId: string;
  ref: string; // "RFI-001" — assigned by numbering domain (BR-DC2)
  questionEn: string;
  questionAr?: string | null;
  linkedDrawingId?: string | null;
  sentDate?: string | null;
  reviewPeriodDays?: number; // default 7 (BR-DC6)
  status?: RfiStatus; // default OPEN
}

export interface RfiUpdateInput {
  questionEn?: string;
  questionAr?: string | null;
  linkedDrawingId?: string | null;
  sentDate?: string | null;
  reviewPeriodDays?: number;
  expectedVersion: number;
}

export type RfiUpdateResult =
  | { kind: "ok"; rfi: Rfi }
  | { kind: "not_found" }
  | { kind: "conflict"; currentVersion: number };

export type RfiDeleteResult =
  | { kind: "ok" }
  | { kind: "not_found" }
  | { kind: "conflict"; currentVersion: number };

export interface RfiEventCreateInput {
  rfiId: string;
  fromStatus?: RfiStatus | null;
  toStatus: RfiStatus;
  note?: string | null;
  eventDate: string; // ISO yyyy-MM-dd (BR-DC1)
  createdByUserId: string;
}

export interface RfiAnswerInput {
  answerEn: string;
  answerAr?: string | null;
  answerDate: string; // ISO yyyy-MM-dd (BR-DC1)
  expectedVersion: number;
}

export type RfiAnswerResult =
  | { kind: "ok"; rfi: Rfi }
  | { kind: "not_found" }
  | { kind: "conflict"; currentVersion: number };

export interface IRfiRepository {
  list(projectId: string, includeDeleted?: boolean): Promise<Rfi[]>;
  getById(id: string, includeDeleted?: boolean): Promise<Rfi | null>;
  create(input: RfiCreateInput): Promise<Rfi>;
  update(id: string, input: RfiUpdateInput): Promise<RfiUpdateResult>;
  softDelete(id: string, expectedVersion: number): Promise<RfiDeleteResult>;
  addEvent(input: RfiEventCreateInput): Promise<RfiEvent>;
  listEvents(rfiId: string): Promise<RfiEvent[]>;
  /** Set the answer text + answer date + status=ANSWERED. Atomically updates
   *  the RFI row. Returns the updated row or a tagged-union variant for
   *  not_found / conflict. The API route writes the RfiEvent after. */
  answer(id: string, input: RfiAnswerInput): Promise<RfiAnswerResult>;
}

// ─── ICorrespondenceRepository ─────────────────────────────────────────────

export interface CorrespondenceCreateInput {
  projectId: string;
  ref: string; // "IN-001" / "OUT-001" (BR-DC2)
  direction: CorrespondenceDirection;
  type: CorrespondenceType;
  date: string; // ISO yyyy-MM-dd (BR-DC1)
  subjectEn: string;
  subjectAr?: string | null;
  fromParty: string;
  toParty: string;
  bodyEn?: string | null;
  bodyAr?: string | null;
}

export interface CorrespondenceUpdateInput {
  type?: CorrespondenceType;
  date?: string;
  subjectEn?: string;
  subjectAr?: string | null;
  fromParty?: string;
  toParty?: string;
  bodyEn?: string | null;
  bodyAr?: string | null;
  expectedVersion: number;
}

export type CorrespondenceUpdateResult =
  | { kind: "ok"; correspondence: Correspondence }
  | { kind: "not_found" }
  | { kind: "conflict"; currentVersion: number };

export type CorrespondenceDeleteResult =
  | { kind: "ok" }
  | { kind: "not_found" }
  | { kind: "conflict"; currentVersion: number };

export interface TransmittalLineCreateInput {
  transmittalId: string; // FK to Correspondence.id where type=TRANSMITTAL
  docRef: string;
  descriptionEn: string;
  descriptionAr?: string | null;
  copies?: number; // default 1
  sortOrder?: number; // default 0
}

export interface ICorrespondenceRepository {
  list(projectId: string, includeDeleted?: boolean): Promise<Correspondence[]>;
  getById(id: string, includeDeleted?: boolean): Promise<Correspondence | null>;
  create(input: CorrespondenceCreateInput): Promise<Correspondence>;
  update(
    id: string,
    input: CorrespondenceUpdateInput,
  ): Promise<CorrespondenceUpdateResult>;
  softDelete(
    id: string,
    expectedVersion: number,
  ): Promise<CorrespondenceDeleteResult>;

  /** List transmittal lines for a Correspondence row (sorted by sortOrder asc). */
  listTransmittalLines(transmittalId: string): Promise<TransmittalLine[]>;
  /** Append a transmittal line. Per BR-DC10, only valid when the parent
   *  Correspondence has type=TRANSMITTAL — the API route enforces this. */
  addTransmittalLine(input: TransmittalLineCreateInput): Promise<TransmittalLine>;
  /** Remove a transmittal line by id. No-op if the line does not exist. */
  removeTransmittalLine(lineId: string): Promise<void>;
}
