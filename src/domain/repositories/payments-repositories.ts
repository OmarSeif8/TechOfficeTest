/**
 * Payments repository interfaces — pure interfaces (no Prisma imports).
 *
 * Lives in src/domain/repositories/ (pure interface — no Prisma imports).
 * Implementations: src/infrastructure/persistence/prisma/payments/*.ts (W4-6).
 *
 * Per CONSTITUTION_V1.1_WEB §3.3 — these are the contracts the API routes
 * (Group V, W4-8..W4-13) use to talk to Phase 4 persistence. Implementations
 * live in the infrastructure layer; the domain never sees Prisma.
 *
 * Entity types come from @shared/entities (plain TS interfaces — no Prisma dep).
 * These plain types mirror the zod schemas in
 * `src/shared/schemas/payments/{ipc,cost-loading}.ts` (wire shape) and the
 * Prisma enums (DB shape, stored as TEXT in SQLite). All three must stay in sync.
 *
 * Layer purity:
 *   - This file imports only @shared/* (entities + payments schemas).
 *   - It MUST NOT import next, react, prisma, fs, path, electron, etc.
 *
 * Conventions (mirror scheduling + doccontrol repositories):
 *   - Read paths default to `deletedAt: null` (live only). Pass includeDeleted=true
 *     to also list tombstoned rows.
 *   - Optimistic concurrency on PaymentApplication / Variation / DailyReport via
 *     `version`.
 *   - BoQItemScheduleLink + child rows (PaymentLine, PaymentDeduction, PaymentAddition,
 *     ActivityProgress, DailyReportManpower/Equipment/WorkDone) are append-only /
 *     replaced-on-edit — no `version` column.
 *   - PaymentApplication lines/deductions/additions are CASCADE-deleted with the
 *     application (no soft-delete on the children).
 */

import type {
  ActivityProgress,
  BoQItemScheduleLink,
  DailyReport,
  DailyReportEquipment,
  DailyReportManpower,
  DailyReportWorkDone,
  PaymentAddition,
  PaymentAdditionType,
  PaymentApplication,
  PaymentDeduction,
  PaymentDeductionType,
  PaymentLine,
  PaymentStatus,
  ProgressUpdate,
  Variation,
  VariationStatus,
} from "@shared/entities";

// ─── IPaymentRepository ──────────────────────────────────────────────────

export interface PaymentLineInput {
  boqItemId: string;
  qtyThisPeriod: string;
  qtyCum: string;
  valueThisPeriod: string;
  valueCum: string;
  rate: string;
  sortOrder?: number;
}

export interface PaymentDeductionInput {
  type: PaymentDeductionType;
  descriptionEn: string;
  amount: string;
  sortOrder?: number;
}

export interface PaymentAdditionInput {
  type: PaymentAdditionType;
  descriptionEn: string;
  amount: string;
  sortOrder?: number;
}

export interface PaymentCreateInput {
  projectId: string;
  ipcNo: number;
  periodStart: string; // ISO yyyy-MM-dd
  periodEnd: string;    // ISO yyyy-MM-dd
  status?: PaymentStatus; // default DRAFT
  contractValue: string;
  retentionPercent: string;
  retentionCapAmount?: string | null;
  advanceAmount: string;
  advanceEnabled: boolean;
  lines?: PaymentLineInput[];
  deductions?: PaymentDeductionInput[];
  additions?: PaymentAdditionInput[];
}

export interface PaymentUpdateInput {
  periodStart?: string;
  periodEnd?: string;
  status?: PaymentStatus;
  contractValue?: string;
  retentionPercent?: string;
  retentionCapAmount?: string | null;
  advanceAmount?: string;
  advanceEnabled?: boolean;
  /** Replace lines/deductions/additions atomically. */
  lines?: PaymentLineInput[];
  deductions?: PaymentDeductionInput[];
  additions?: PaymentAdditionInput[];
  /** Optimistic concurrency (BR-WEB-4). Must match the current version. */
  expectedVersion: number;
}

export type PaymentUpdateResult =
  | { kind: "ok"; application: PaymentApplication }
  | { kind: "not_found" }
  | { kind: "conflict"; currentVersion: number };

export type PaymentDeleteResult =
  | { kind: "ok" }
  | { kind: "not_found" }
  | { kind: "conflict"; currentVersion: number };

/** Application detail — header + child rows. */
export interface PaymentApplicationDetail {
  application: PaymentApplication;
  lines: PaymentLine[];
  deductions: PaymentDeduction[];
  additions: PaymentAddition[];
}

export interface IPaymentRepository {
  /** List applications for a project (sorted by ipcNo asc), excluding soft-deleted by default. */
  list(projectId: string, includeDeleted?: boolean): Promise<PaymentApplication[]>;
  /** Fetch a single application header (no children). */
  getById(id: string, includeDeleted?: boolean): Promise<PaymentApplication | null>;
  /** Fetch a single application with all child rows (lines, deductions, additions). */
  getDetail(id: string, includeDeleted?: boolean): Promise<PaymentApplicationDetail | null>;
  create(input: PaymentCreateInput): Promise<PaymentApplication>;
  update(id: string, input: PaymentUpdateInput): Promise<PaymentUpdateResult>;
  softDelete(id: string, expectedVersion: number): Promise<PaymentDeleteResult>;
}

// ─── IVariationRepository ────────────────────────────────────────────────

export interface VariationCreateInput {
  projectId: string;
  boqDocumentId?: string | null;
  ref: string;
  titleEn: string;
  titleAr?: string | null;
  status?: VariationStatus; // default DRAFT
  approvedValue?: string | null;
}

export interface VariationUpdateInput {
  boqDocumentId?: string | null;
  ref?: string;
  titleEn?: string;
  titleAr?: string | null;
  status?: VariationStatus;
  approvedValue?: string | null;
  expectedVersion: number;
}

export interface VariationApproveInput {
  approvedValue: string;
  expectedVersion: number;
}

export type VariationUpdateResult =
  | { kind: "ok"; variation: Variation }
  | { kind: "not_found" }
  | { kind: "conflict"; currentVersion: number };

export type VariationDeleteResult =
  | { kind: "ok" }
  | { kind: "not_found" }
  | { kind: "conflict"; currentVersion: number };

export interface IVariationRepository {
  list(projectId: string, includeDeleted?: boolean): Promise<Variation[]>;
  getById(id: string, includeDeleted?: boolean): Promise<Variation | null>;
  create(input: VariationCreateInput): Promise<Variation>;
  update(id: string, input: VariationUpdateInput): Promise<VariationUpdateResult>;
  softDelete(id: string, expectedVersion: number): Promise<VariationDeleteResult>;
  /** Transition status to APPROVED + set approvedValue atomically. */
  approve(id: string, input: VariationApproveInput): Promise<VariationUpdateResult>;
}

// ─── IProgressRepository ────────────────────────────────────────────────
// Combines ProgressUpdate (header) + ActivityProgress (rows) into a single
// create transaction.

export interface ActivityProgressInput {
  activityId: string;
  percentComplete: number; // 0..100
  actualStart?: string | null; // ISO yyyy-MM-dd
  actualFinish?: string | null; // ISO yyyy-MM-dd
}

export interface ProgressCreateInput {
  projectId: string;
  dataDate: string; // ISO yyyy-MM-dd — BR-DC1 injected clock
  scheduleRunId?: string | null;
  notes?: string | null;
  activityProgress: ActivityProgressInput[];
}

export interface ProgressUpdateDetail {
  update: ProgressUpdate;
  activityProgress: ActivityProgress[];
}

export interface IProgressRepository {
  list(projectId: string): Promise<ProgressUpdate[]>;
  getById(id: string): Promise<ProgressUpdate | null>;
  getDetail(id: string): Promise<ProgressUpdateDetail | null>;
  create(input: ProgressCreateInput): Promise<ProgressUpdate>;
}

// ─── IDailyReportRepository ──────────────────────────────────────────────

export interface DailyReportManpowerInput {
  tradeEn: string;
  tradeAr?: string | null;
  count: number;
  sortOrder?: number;
}

export interface DailyReportEquipmentInput {
  descriptionEn: string;
  unit?: string | null;
  count: number;
  hours?: string | null;
  sortOrder?: number;
}

export interface DailyReportWorkDoneInput {
  locationEn: string;
  locationAr?: string | null;
  descriptionEn: string;
  descriptionAr?: string | null;
  activityId?: string | null;
  sortOrder?: number;
}

export interface DailyReportCreateInput {
  projectId: string;
  date: string; // ISO yyyy-MM-dd
  weather?: string | null;
  temperature?: string | null;
  notesEn?: string | null;
  notesAr?: string | null;
  manpower?: DailyReportManpowerInput[];
  equipment?: DailyReportEquipmentInput[];
  workDone?: DailyReportWorkDoneInput[];
}

export interface DailyReportUpdateInput {
  date?: string;
  weather?: string | null;
  temperature?: string | null;
  notesEn?: string | null;
  notesAr?: string | null;
  /** Replace child rows atomically. */
  manpower?: DailyReportManpowerInput[];
  equipment?: DailyReportEquipmentInput[];
  workDone?: DailyReportWorkDoneInput[];
  expectedVersion: number;
}

export type DailyReportUpdateResult =
  | { kind: "ok"; report: DailyReport }
  | { kind: "not_found" }
  | { kind: "conflict"; currentVersion: number };

export type DailyReportDeleteResult =
  | { kind: "ok" }
  | { kind: "not_found" }
  | { kind: "conflict"; currentVersion: number };

export interface DailyReportDetail {
  report: DailyReport;
  manpower: DailyReportManpower[];
  equipment: DailyReportEquipment[];
  workDone: DailyReportWorkDone[];
}

export interface IDailyReportRepository {
  list(projectId: string, includeDeleted?: boolean): Promise<DailyReport[]>;
  getById(id: string, includeDeleted?: boolean): Promise<DailyReport | null>;
  getDetail(id: string, includeDeleted?: boolean): Promise<DailyReportDetail | null>;
  create(input: DailyReportCreateInput): Promise<DailyReport>;
  update(id: string, input: DailyReportUpdateInput): Promise<DailyReportUpdateResult>;
  softDelete(id: string, expectedVersion: number): Promise<DailyReportDeleteResult>;
}

// ─── BoQItemScheduleLink (cost-loading link) ─────────────────────────────
// Lives on the IProgressRepository? No — split. For MVP we add cost-loading
// operations to a small subset of the IPaymentRepository? No — cost loading
// is conceptually closer to "links". The API route uses db directly via the
// prisma client (services.prisma) since the link is a simple bridge table
// and the domain logic (validateAllocations, computeCoverage) is pure.
// We expose the link types here for the route's convenience.

export type { BoQItemScheduleLink } from "@shared/entities";
