/**
 * Provider Registry — the DI wiring point.
 *
 * Per CONSTITUTION_V1.1_WEB §3.3 + PLATFORM_PORTABILITY §4.1:
 *   - This file is **server-only** — never imported by client components.
 *   - It wires concrete implementations to their interfaces.
 *   - This is the ONLY file that knows about Prisma + ZaiAiProvider + NextAuthProvider
 *     + all repository impls simultaneously. Everything else consumes interfaces.
 *
 * Migration path (per PLATFORM_PORTABILITY §5):
 *   - Web MVP (this file): Prisma repositories + ZaiAiProvider + NextAuthProvider
 *   - Future Electron port: a parallel `registry.electron.ts` would wire
 *     Sqlite*Repository (using better-sqlite3 directly) + OllamaProvider
 *     (HTTP to localhost:11434) + a LicenseFileAuthProvider. The domain layer
 *     and UI components are unchanged.
 *
 * Usage:
 *   import { getServices } from "@/lib/services";
 *   const services = await getServices();
 *   const project = await services.projects.getById(id);
 */

import type { PrismaClient } from "@prisma/client";

import { db } from "@/lib/db";
import { ZaiAiProvider } from "@/services/ai/zai-provider";
import type { IAiProvider } from "@/services/ai/types";
import { NextAuthProvider } from "@/services/auth/next-auth-provider";
import type { IAuthProvider } from "@/services/auth/types";
import type {
  IProjectRepository,
  IBoQRepository,
  IItemLibraryRepository,
} from "@domain/repositories";
import type {
  ICalculationRepository,
  IRateAnalysisRepository,
} from "@domain/repositories";
import type {
  IWbsRepository,
  IActivityRepository,
  IScheduleRepository,
  ICalendarRepository,
} from "@domain/repositories";
import type {
  IDrawingRepository,
  ISubmittalRepository,
  IRfiRepository,
  ICorrespondenceRepository,
} from "@domain/repositories";
import type {
  IPaymentRepository,
  IVariationRepository,
  IProgressRepository,
  IDailyReportRepository,
} from "@domain/repositories";
import { PrismaProjectRepository } from "@/infrastructure/persistence/prisma/project-repository";
import { PrismaBoQRepository } from "@/infrastructure/persistence/prisma/boq-repository";
import { PrismaItemLibraryRepository } from "@/infrastructure/persistence/prisma/item-library-repository";
import { PrismaCalculationRepository } from "@/infrastructure/persistence/prisma/calculation-repository";
import { PrismaRateAnalysisRepository } from "@/infrastructure/persistence/prisma/rate-analysis-repository";
import { PrismaWbsRepository } from "@/infrastructure/persistence/prisma/scheduling/wbs-repository";
import { PrismaActivityRepository } from "@/infrastructure/persistence/prisma/scheduling/activity-repository";
import { PrismaScheduleRepository } from "@/infrastructure/persistence/prisma/scheduling/schedule-repository";
import { PrismaCalendarRepository } from "@/infrastructure/persistence/prisma/scheduling/calendar-repository";
import { PrismaDrawingRepository } from "@/infrastructure/persistence/prisma/doccontrol/drawing-repository";
import { PrismaSubmittalRepository } from "@/infrastructure/persistence/prisma/doccontrol/submittal-repository";
import { PrismaRfiRepository } from "@/infrastructure/persistence/prisma/doccontrol/rfi-repository";
import { PrismaCorrespondenceRepository } from "@/infrastructure/persistence/prisma/doccontrol/correspondence-repository";
import { PrismaPaymentRepository } from "@/infrastructure/persistence/prisma/payments/payment-repository";
import { PrismaVariationRepository } from "@/infrastructure/persistence/prisma/payments/variation-repository";
import { PrismaProgressRepository } from "@/infrastructure/persistence/prisma/payments/progress-repository";
import { PrismaDailyReportRepository } from "@/infrastructure/persistence/prisma/payments/daily-report-repository";

// ─── Registry (lazy singleton per server process) ────────────────────────

interface ServiceContainer {
  prisma: PrismaClient;
  ai: IAiProvider;
  auth: IAuthProvider;
  // Repositories — wired lazily on first access (below)
  projects: IProjectRepository;
  boq: IBoQRepository;
  library: IItemLibraryRepository;
  calculation: ICalculationRepository;
  rateAnalysis: IRateAnalysisRepository;
  // Phase 2 — Scheduling
  wbs: IWbsRepository;
  activities: IActivityRepository;
  schedules: IScheduleRepository;
  calendars: ICalendarRepository;
  // Phase 3A — Document Control
  drawings: IDrawingRepository;
  submittals: ISubmittalRepository;
  rfis: IRfiRepository;
  correspondence: ICorrespondenceRepository;
  // Phase 4 — Payments / Variations / Progress / Daily Reports
  payments: IPaymentRepository;
  variations: IVariationRepository;
  progress: IProgressRepository;
  dailyReports: IDailyReportRepository;
}

let container: ServiceContainer | null = null;

/**
 * Get the service container — lazy-initialized singleton.
 *
 * All repositories are now wired (Group D + Group K complete). Server-only.
 */
export function getContainer(): ServiceContainer {
  if (container) return container;

  // ─── Wire up providers ──────────────────────────────────────────────
  const ai = new ZaiAiProvider({
    apiKey: process.env.ZAI_API_KEY,
  });

  const auth = new NextAuthProvider();

  // ─── Wire up repositories (Group D — Prisma impls) ────────────────
  const projects = new PrismaProjectRepository();
  const boq = new PrismaBoQRepository();
  const library = new PrismaItemLibraryRepository();
  const calculation = new PrismaCalculationRepository();
  const rateAnalysis = new PrismaRateAnalysisRepository();

  // ─── Wire up Phase 2 — Scheduling repositories (Group K) ────────
  const wbs = new PrismaWbsRepository();
  const activities = new PrismaActivityRepository();
  const schedules = new PrismaScheduleRepository();
  const calendars = new PrismaCalendarRepository();

  // ─── Wire up Phase 3A — Document Control repositories (Group O) ────
  const drawings = new PrismaDrawingRepository();
  const submittals = new PrismaSubmittalRepository();
  const rfis = new PrismaRfiRepository();
  const correspondence = new PrismaCorrespondenceRepository();

  // ─── Wire up Phase 4 — Payments / Variations / Progress / Daily Reports (Group U) ────
  const payments = new PrismaPaymentRepository();
  const variations = new PrismaVariationRepository();
  const progress = new PrismaProgressRepository();
  const dailyReports = new PrismaDailyReportRepository();

  container = {
    prisma: db,
    ai,
    auth,
    projects,
    boq,
    library,
    calculation,
    rateAnalysis,
    wbs,
    activities,
    schedules,
    calendars,
    drawings,
    submittals,
    rfis,
    correspondence,
    payments,
    variations,
    progress,
    dailyReports,
  };

  return container;
}

/**
 * Register repository implementations manually (for tests or custom wiring).
 *
 * Most callers should NOT use this — `getContainer()` auto-wires all
 * repositories. This is only for tests that want to inject mock impls.
 */
export function registerRepositories(impls: Partial<{
  projects: IProjectRepository;
  boq: IBoQRepository;
  library: IItemLibraryRepository;
  calculation: ICalculationRepository;
  rateAnalysis: IRateAnalysisRepository;
  wbs: IWbsRepository;
  activities: IActivityRepository;
  schedules: IScheduleRepository;
  calendars: ICalendarRepository;
  drawings: IDrawingRepository;
  submittals: ISubmittalRepository;
  rfis: IRfiRepository;
  correspondence: ICorrespondenceRepository;
  payments: IPaymentRepository;
  variations: IVariationRepository;
  progress: IProgressRepository;
  dailyReports: IDailyReportRepository;
}>): void {
  const c = getContainer();
  if (impls.projects) c.projects = impls.projects;
  if (impls.boq) c.boq = impls.boq;
  if (impls.library) c.library = impls.library;
  if (impls.calculation) c.calculation = impls.calculation;
  if (impls.rateAnalysis) c.rateAnalysis = impls.rateAnalysis;
  if (impls.wbs) c.wbs = impls.wbs;
  if (impls.activities) c.activities = impls.activities;
  if (impls.schedules) c.schedules = impls.schedules;
  if (impls.calendars) c.calendars = impls.calendars;
  if (impls.drawings) c.drawings = impls.drawings;
  if (impls.submittals) c.submittals = impls.submittals;
  if (impls.rfis) c.rfis = impls.rfis;
  if (impls.correspondence) c.correspondence = impls.correspondence;
  if (impls.payments) c.payments = impls.payments;
  if (impls.variations) c.variations = impls.variations;
  if (impls.progress) c.progress = impls.progress;
  if (impls.dailyReports) c.dailyReports = impls.dailyReports;
}

/**
 * Reset the container — used in tests to isolate between test cases.
 */
export function _resetContainerForTesting(): void {
  container = null;
}
