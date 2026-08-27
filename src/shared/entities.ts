/**
 * Shared entity types — plain TypeScript interfaces mirroring the Prisma models.
 *
 * Per CONSTITUTION_V1.1_WEB §3.3 — these types live in @shared/ (the lowest layer)
 * so they can be imported by domain, services, infrastructure, and app layers
 * without any of them having to depend on @prisma/client.
 *
 * The Prisma schema (prisma/schema.prisma) is the source of truth for the DB
 * shape. These interfaces mirror it manually. When the schema changes, update
 * these types too. A future improvement could auto-generate these from Prisma.
 */

// ─── Enums (mirror Prisma enums; stored as TEXT in SQLite) ──────────────

export type UserRole = "USER" | "ADMIN";
export type UserLocale = "en" | "ar";
export type SubscriptionStatus = "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELED";
export type SubscriptionPlan = "FREE" | "PRO" | "ENTERPRISE";
export type BoQDocumentStatus = "DRAFT" | "FINALIZED" | "ARCHIVED";
export type BoQItemType =
  | "RATE_BASED"
  | "LUMP_SUM"
  | "PROVISIONAL_SUM"
  | "DAYWORK"
  | "UNIT_ONLY";
export type RateAnalysisLaborMode = "CONSUMPTION" | "CREW";
export type RateAnalysisLineType =
  | "MATERIAL"
  | "LABOR"
  | "EQUIPMENT"
  | "SUBCONTRACT";
export type CalculatorType =
  | "CONCRETE"
  | "FORMWORK"
  | "REBAR"
  | "MASONRY"
  | "PLASTER"
  | "PAINT";
export type ImportBatchStatus =
  | "PENDING"
  | "VALIDATED"
  | "COMMITTED"
  | "FAILED";
export type LibraryItemScope = "APP_GLOBAL" | "USER_PRIVATE";

// ─── Phase 2 — Scheduling enums ──────────────────────────────────────────
// Mirror the RelationshipType + ScheduleRunStatus Prisma enums (stored as TEXT).

export type RelationshipType = "FS" | "SS" | "FF" | "SF";
export type ScheduleRunStatus = "SUCCESS" | "CYCLE_DETECTED" | "VALIDATION_ERROR";

// ─── User & Auth ──────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  name: string | null;
  passwordHash: string | null;
  role: UserRole;
  locale: UserLocale;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface UserSettings {
  userId: string;
  theme: "light" | "dark";
  locale: UserLocale;
  defaultLaborMode: RateAnalysisLaborMode;
  defaultOverheadPct: string;
  defaultProfitPct: string;
  version: number;
  updatedAt: Date;
}

// ─── Project ───────────────────────────────────────────────────────────────

export interface Project {
  id: string;
  ownerId: string;
  nameEn: string;
  nameAr: string | null;
  clientEn: string | null;
  clientAr: string | null;
  locationEn: string | null;
  locationAr: string | null;
  contractNo: string | null;
  currency: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

// ─── BoQ ────────────────────────────────────────────────────────────────

export interface BoQDocument {
  id: string;
  projectId: string;
  nameEn: string;
  nameAr: string | null;
  status: BoQDocumentStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface BoQSection {
  id: string;
  documentId: string;
  projectId: string;
  code: string;
  titleEn: string;
  titleAr: string | null;
  sortOrder: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface BoQItem {
  id: string;
  sectionId: string;
  documentId: string;
  projectId: string;
  code: string | null;
  descriptionEn: string;
  descriptionAr: string | null;
  unitId: string | null;
  quantity: string;
  rate: string;
  amount: string;
  itemType: BoQItemType;
  libraryItemId: string | null;
  rateAnalysisId: string | null;
  calculationRecordId: string | null;
  sortOrder: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

// ─── Rate Analysis ──────────────────────────────────────────────────────

export interface RateAnalysis {
  id: string;
  boqItemId: string | null;
  projectId: string;
  totalRate: string;
  overheadPct: string;
  profitPct: string;
  laborMode: RateAnalysisLaborMode;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface RateAnalysisLine {
  id: string;
  rateAnalysisId: string;
  lineType: RateAnalysisLineType;
  descriptionEn: string;
  descriptionAr: string | null;
  quantity: string;
  unitId: string | null;
  unitPrice: string;
  wastePct: string;
  total: string;
  sortOrder: number;
}

// ─── Calculations ────────────────────────────────────────────────────────

export interface CalculationRecord {
  id: string;
  projectId: string;
  calculatorType: CalculatorType;
  inputsJson: string;
  resultJson: string;
  resultQuantity: string;
  resultUnitId: string | null;
  linkedBoqItemId: string | null;
  linkedAt: Date | null;
  createdAt: Date;
}

// ─── Library ────────────────────────────────────────────────────────────

export interface LibraryCategory {
  id: string;
  parentId: string | null;
  nameEn: string;
  nameAr: string | null;
  sortOrder: number;
}

export interface ItemLibrary {
  id: string;
  categoryId: string | null;
  code: string | null;
  descriptionEn: string;
  descriptionAr: string | null;
  unitId: string | null;
  defaultSpecsEn: string | null;
  defaultSpecsAr: string | null;
  scope: LibraryItemScope;
  ownerId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Reference data ──────────────────────────────────────────────────────

export interface Unit {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string | null;
  defaultPrecision: number;
}

export interface RebarDiameter {
  id: string;
  diameterMm: number;
  weightKgPerM: string;
}

export interface ShapeCode {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string | null;
  illustrationRef: string | null;
}

// ─── Phase 2 — Scheduling (CPM engine per SPEC_PHASE2_WEB.md §5) ────────
//
// All date columns are ISO yyyy-MM-dd strings per BR-P1 (no JS Date objects
// in the engine). `version` on ProjectCalendar + Activity is for optimistic
// concurrency. `deletedAt` on WbsNode + Activity provides soft-delete.
// ScheduleRun is immutable (BR-WEB-P3): no `updatedAt`, no `deletedAt`.

export interface ProjectCalendar {
  id: string;
  projectId: string;
  mondayWorking: boolean;
  tuesdayWorking: boolean;
  wednesdayWorking: boolean;
  thursdayWorking: boolean;
  fridayWorking: boolean;
  saturdayWorking: boolean;
  sundayWorking: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CalendarException {
  id: string;
  calendarId: string;
  date: string; // ISO yyyy-MM-dd (BR-P1)
  isWorking: boolean;
  nameEn: string | null;
  nameAr: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WbsNode {
  id: string;
  projectId: string;
  parentId: string | null;
  code: string;
  nameEn: string;
  nameAr: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface Activity {
  id: string;
  projectId: string;
  wbsNodeId: string | null;
  code: string;
  nameEn: string;
  nameAr: string | null;
  duration: number; // working days, ≥ 0 per BR-P3
  isMilestone: boolean;
  sortOrder: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface ActivityRelationship {
  id: string;
  projectId: string;
  predecessorId: string;
  successorId: string;
  type: RelationshipType; // FS | SS | FF | SF
  lag: number; // working days, any sign (BR-P4)
  createdAt: Date;
  updatedAt: Date;
}

export interface ScheduleRun {
  id: string;
  projectId: string;
  projectStart: string; // ISO yyyy-MM-dd (BR-P1)
  status: ScheduleRunStatus;
  projectFinishDate: string | null;
  criticalPathJson: string | null;
  warningsJson: string | null;
  errorJson: string | null;
  runById: string;
  createdAt: Date;
}

export interface ScheduleActivity {
  id: string;
  scheduleRunId: string;
  activityId: string;
  es: string; // ISO yyyy-MM-dd — early start
  ef: string; // ISO yyyy-MM-dd — early finish
  ls: string; // ISO yyyy-MM-dd — late start
  lf: string; // ISO yyyy-MM-dd — late finish
  totalFloatDays: number; // working days (BR-P12)
  isCritical: boolean;
  createdAt: Date;
}

// ─── Phase 3A — Document Control (per SPEC_PHASE3_WEB.md §5) ─────────────
//
// All date columns are ISO yyyy-MM-dd strings per BR-DC1 (injected clocks —
// no Date.now() in src/domain/). `version` on Drawing/Submittal/Rfi/Correspondence
// is for optimistic concurrency. `deletedAt` provides soft-delete (numbering
// domain reads soft-deleted refs to honor BR-DC2 "never reused").
//
// These plain TS types mirror the zod schemas in
// `src/shared/schemas/doccontrol/entities.ts` (wire shape) and the Prisma
// enums (DB shape, stored as TEXT in SQLite). All three must stay in sync.

export type Discipline =
  | "ARC"
  | "STR"
  | "CIV"
  | "MEC"
  | "ELE"
  | "PLB"
  | "FIR"
  | "LND";

export type DrawingStatus =
  | "PRELIMINARY"
  | "ISSUED"
  | "APPROVED_FOR_CONSTRUCTION"
  | "SUPERSEDED"
  | "OBSOLETE";

export type SubmittalStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "APPROVED"
  | "APPROVED_WITH_COMMENTS"
  | "REJECTED"
  | "REVISE_RESUBMIT";

export type SubmittalType = "MATERIAL" | "TECHNICAL";

export type RfiStatus = "OPEN" | "ANSWERED" | "CLOSED" | "CANCELLED";

export type CorrespondenceDirection = "INCOMING" | "OUTGOING";

export type CorrespondenceType =
  | "LETTER"
  | "MEMO"
  | "TRANSMITTAL"
  | "EMAIL"
  | "OTHER";

export type DrawingRevisionEventType =
  | "REVISION_ADDED"
  | "STATUS_CHANGED"
  | "SUPERSEDED";

export interface Drawing {
  id: string;
  projectId: string;
  code: string; // engineer-assigned, unique per project (BR-DC2)
  titleEn: string;
  titleAr: string | null;
  discipline: Discipline;
  currentRevisionId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface DrawingRevision {
  id: string;
  drawingId: string;
  revision: string; // "A", "B", ..., "Z", "AA", ...
  status: DrawingStatus;
  revisionDate: string; // ISO yyyy-MM-dd (BR-DC1)
  fileUploadId: string | null; // BR-DC3: required on new revisions
  notes: string | null;
  createdByUserId: string;
  createdAt: Date;
}

export interface DrawingRevisionEvent {
  id: string;
  drawingId: string;
  revisionId: string;
  eventType: DrawingRevisionEventType;
  fromStatus: DrawingStatus | null;
  toStatus: DrawingStatus;
  note: string | null;
  eventDate: string; // ISO yyyy-MM-dd (BR-DC1)
  createdByUserId: string;
  createdAt: Date;
}

export interface Submittal {
  id: string;
  projectId: string;
  ref: string; // "SUB-001" (BR-DC2)
  subjectEn: string;
  subjectAr: string | null;
  type: SubmittalType;
  discipline: Discipline;
  submittedDate: string | null; // ISO yyyy-MM-dd (BR-DC1)
  reviewPeriodDays: number; // calendar days (BR-DC6); default 14
  resubmissionNo: number; // 0 = first submission
  status: SubmittalStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface SubmittalEvent {
  id: string;
  submittalId: string;
  fromStatus: SubmittalStatus | null;
  toStatus: SubmittalStatus;
  note: string | null;
  eventDate: string; // ISO yyyy-MM-dd (BR-DC1)
  createdByUserId: string;
  createdAt: Date;
}

export interface Rfi {
  id: string;
  projectId: string;
  ref: string; // "RFI-001" (BR-DC2)
  questionEn: string;
  questionAr: string | null;
  linkedDrawingId: string | null;
  sentDate: string | null; // ISO yyyy-MM-dd (BR-DC1)
  reviewPeriodDays: number; // calendar days (BR-DC6); default 7
  answerEn: string | null;
  answerAr: string | null;
  answerDate: string | null; // ISO yyyy-MM-dd (BR-DC1)
  status: RfiStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface RfiEvent {
  id: string;
  rfiId: string;
  fromStatus: RfiStatus | null;
  toStatus: RfiStatus;
  note: string | null;
  eventDate: string; // ISO yyyy-MM-dd (BR-DC1)
  createdByUserId: string;
  createdAt: Date;
}

export interface Correspondence {
  id: string;
  projectId: string;
  ref: string; // "IN-001" or "OUT-001" (BR-DC2)
  direction: CorrespondenceDirection;
  type: CorrespondenceType;
  date: string; // ISO yyyy-MM-dd (BR-DC1)
  subjectEn: string;
  subjectAr: string | null;
  fromParty: string;
  toParty: string;
  bodyEn: string | null;
  bodyAr: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface TransmittalLine {
  id: string;
  transmittalId: string; // FK to Correspondence.id where type=TRANSMITTAL
  docRef: string;
  descriptionEn: string;
  descriptionAr: string | null;
  copies: number; // integer ≥ 0
  sortOrder: number;
}

// ─── Phase 4 — Payments, Cost-Schedule, Progress, Daily Reports ──────────
//
// Per SPEC_PHASE4_WEB.md §4 (Phase 4 — the strategic differentiator).
//
// All money/percent values are decimal strings (BR-IP1, BR-CS1).
// `version` on PaymentApplication, Variation, DailyReport is for optimistic
// concurrency. `deletedAt` provides soft-delete. BoQItemScheduleLink,
// ActivityProgress, and the DailyReport child tables are append-only /
// replaced-on-edit (no version column).

// ─── Payments enums ──────────────────────────────────────────────────────
export type PaymentStatus = "DRAFT" | "SUBMITTED" | "CERTIFIED";
export type PaymentDeductionType = "PENALTY" | "BACKCHARGE" | "OTHER";
export type PaymentAdditionType = "MATERIALS_ON_SITE" | "OTHER";
export type VariationStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";

// ─── Payments entities ──────────────────────────────────────────────────
export interface PaymentApplication {
  id: string;
  projectId: string;
  ipcNo: number;
  periodStart: string; // ISO yyyy-MM-dd
  periodEnd: string;    // ISO yyyy-MM-dd
  status: PaymentStatus;
  contractValue: string;
  retentionPercent: string;
  retentionCapAmount: string | null;
  advanceAmount: string;
  advanceEnabled: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface PaymentLine {
  id: string;
  applicationId: string;
  boqItemId: string;
  qtyThisPeriod: string;
  qtyCum: string;
  valueThisPeriod: string;
  valueCum: string;
  rate: string;
  sortOrder: number;
}

export interface PaymentDeduction {
  id: string;
  applicationId: string;
  type: PaymentDeductionType;
  descriptionEn: string;
  amount: string;
  sortOrder: number;
}

export interface PaymentAddition {
  id: string;
  applicationId: string;
  type: PaymentAdditionType;
  descriptionEn: string;
  amount: string;
  sortOrder: number;
}

// ─── Variation entity ────────────────────────────────────────────────────
export interface Variation {
  id: string;
  projectId: string;
  boqDocumentId: string | null;
  ref: string;
  titleEn: string;
  titleAr: string | null;
  status: VariationStatus;
  approvedValue: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

// ─── Cost-loading link (BoQItem ↔ Activity) ──────────────────────────────
export interface BoQItemScheduleLink {
  id: string;
  projectId: string;
  boqItemId: string;
  activityId: string;
  allocationPct: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Progress (earned value) ──────────────────────────────────────────────
export interface ProgressUpdate {
  id: string;
  projectId: string;
  dataDate: string;       // ISO yyyy-MM-dd — BR-DC1 injected clock
  scheduleRunId: string | null;
  notes: string | null;
  version: number;
  createdAt: Date;
}

export interface ActivityProgress {
  id: string;
  progressUpdateId: string;
  activityId: string;
  percentComplete: number; // 0..100
  actualStart: string | null; // ISO yyyy-MM-dd
  actualFinish: string | null; // ISO yyyy-MM-dd
}

// ─── Daily Reports ────────────────────────────────────────────────────────
export interface DailyReport {
  id: string;
  projectId: string;
  date: string;       // ISO yyyy-MM-dd
  weather: string | null;
  temperature: string | null;
  notesEn: string | null;
  notesAr: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface DailyReportManpower {
  id: string;
  dailyReportId: string;
  tradeEn: string;
  tradeAr: string | null;
  count: number;
  sortOrder: number;
}

export interface DailyReportEquipment {
  id: string;
  dailyReportId: string;
  descriptionEn: string;
  unit: string | null;
  count: number;
  hours: string | null;
  sortOrder: number;
}

export interface DailyReportWorkDone {
  id: string;
  dailyReportId: string;
  locationEn: string;
  locationAr: string | null;
  descriptionEn: string;
  descriptionAr: string | null;
  activityId: string | null;
  sortOrder: number;
}
