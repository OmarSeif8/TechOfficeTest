/**
 * Repository interfaces barrel export.
 *
 * All repository interfaces live in src/domain/repositories/ (pure interfaces).
 * Implementations live in src/infrastructure/persistence/prisma/.
 *
 * Import pattern:
 *   import type { IProjectRepository, IBoQRepository } from "@domain/repositories";
 *
 * Entity types (Project, BoQDocument, BoQItem, etc.) come from @shared/entities
 * — plain TS interfaces, no Prisma dependency. This keeps the domain layer
 * portable across Next.js, Electron, Tauri, and React Native.
 */

export type {
  IProjectRepository,
  ProjectListOptions,
  ProjectCreateInput,
  ProjectUpdateInput,
  ProjectUpdateResult,
  ProjectDeleteResult,
} from "./project-repository";

export type {
  IBoQRepository,
  BoQDocumentCreateInput,
  BoQSectionCreateInput,
  BoQItemCreateInput,
  BoQItemUpdateInput,
  BoQItemUpdateResult,
  BoQDocumentDeleteResult,
  BoQItemDeleteResult,
} from "./boq-repository";

export type {
  IItemLibraryRepository,
  LibraryItemSearchOptions,
  LibraryItemCreateInput,
} from "./item-library-repository";

export type {
  ICalculationRepository,
  CalculationRecordCreateInput,
} from "./calculation-repository";

export type {
  IRateAnalysisRepository,
  RateAnalysisLineInput,
  RateAnalysisCreateInput,
  RateAnalysisUpdateInput,
  RateAnalysisUpdateResult,
} from "./rate-analysis-repository";

// ─── Phase 2 — Scheduling repositories (Group K, W2-5) ───────────────────
export type {
  IWbsRepository,
  WbsNodeCreateInput,
  WbsNodeUpdateInput,
  WbsNodeUpdateResult,
  WbsNodeDeleteResult,
  IActivityRepository,
  ActivityCreateInput,
  ActivityUpdateInput,
  ActivityUpdateResult,
  ActivityDeleteResult,
  RelationshipCreateInput,
  IScheduleRepository,
  ScheduleRunContext,
  ScheduleRunWithActivities,
  ICalendarRepository,
  CalendarMaskInput,
  CalendarUpsertInput,
  CalendarExceptionInput,
} from "./scheduling-repositories";

// ─── Phase 3A — Document Control repositories (Group O, W3-4) ───────────
export type {
  IDrawingRepository,
  DrawingCreateInput,
  DrawingUpdateInput,
  DrawingUpdateResult,
  DrawingDeleteResult,
  DrawingRevisionCreateInput,
  DrawingRevisionEventCreateInput,
  ISubmittalRepository,
  SubmittalCreateInput,
  SubmittalUpdateInput,
  SubmittalUpdateResult,
  SubmittalDeleteResult,
  SubmittalEventCreateInput,
  IRfiRepository,
  RfiCreateInput,
  RfiUpdateInput,
  RfiUpdateResult,
  RfiDeleteResult,
  RfiEventCreateInput,
  RfiAnswerInput,
  RfiAnswerResult,
  ICorrespondenceRepository,
  CorrespondenceCreateInput,
  CorrespondenceUpdateInput,
  CorrespondenceUpdateResult,
  CorrespondenceDeleteResult,
  TransmittalLineCreateInput,
} from "./doccontrol-repositories";

// ─── Phase 4 — Payments / Variations / Progress / Daily Reports (Group U, W4-6) ───
export type {
  IPaymentRepository,
  PaymentLineInput,
  PaymentDeductionInput,
  PaymentAdditionInput,
  PaymentCreateInput,
  PaymentUpdateInput,
  PaymentUpdateResult,
  PaymentDeleteResult,
  PaymentApplicationDetail,
  IVariationRepository,
  VariationCreateInput,
  VariationUpdateInput,
  VariationApproveInput,
  VariationUpdateResult,
  VariationDeleteResult,
  IProgressRepository,
  ActivityProgressInput,
  ProgressCreateInput,
  ProgressUpdateDetail,
  IDailyReportRepository,
  DailyReportManpowerInput,
  DailyReportEquipmentInput,
  DailyReportWorkDoneInput,
  DailyReportCreateInput,
  DailyReportUpdateInput,
  DailyReportUpdateResult,
  DailyReportDeleteResult,
  DailyReportDetail,
} from "./payments-repositories";
