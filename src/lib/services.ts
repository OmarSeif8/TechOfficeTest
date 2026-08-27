/**
 * Per-request service factory — thin wrapper around the registry.
 *
 * Server-only. Importing this file from a Client Component will fail at
 * build time (Prisma, ZaiAiProvider, NextAuthProvider all require server).
 *
 * Usage in API routes:
 *   import { getServices } from "@/lib/services";
 *   const services = await getServices();
 *   const projects = await services.projects.list({ ownerId: userId });
 *
 * All services are always available (Group D repositories are wired in the
 * registry — no more lazy-throws).
 */

import { getContainer } from "@/infrastructure/registry";
import type {
  IProjectRepository,
  IBoQRepository,
  IItemLibraryRepository,
  ICalculationRepository,
  IRateAnalysisRepository,
  IWbsRepository,
  IActivityRepository,
  IScheduleRepository,
  ICalendarRepository,
  IDrawingRepository,
  ISubmittalRepository,
  IRfiRepository,
  ICorrespondenceRepository,
  IPaymentRepository,
  IVariationRepository,
  IProgressRepository,
  IDailyReportRepository,
} from "@domain/repositories";
import type { IAiProvider } from "@/services/ai/types";
import type { IAuthProvider } from "@/services/auth/types";
import type { PrismaClient } from "@prisma/client";

export interface Services {
  readonly projects: IProjectRepository;
  readonly boq: IBoQRepository;
  readonly library: IItemLibraryRepository;
  readonly calculation: ICalculationRepository;
  readonly rateAnalysis: IRateAnalysisRepository;
  // Phase 2 — Scheduling
  readonly wbs: IWbsRepository;
  readonly activities: IActivityRepository;
  readonly schedules: IScheduleRepository;
  readonly calendars: ICalendarRepository;
  // Phase 3A — Document Control
  readonly drawings: IDrawingRepository;
  readonly submittals: ISubmittalRepository;
  readonly rfis: IRfiRepository;
  readonly correspondence: ICorrespondenceRepository;
  // Phase 4 — Payments / Variations / Progress / Daily Reports
  readonly payments: IPaymentRepository;
  readonly variations: IVariationRepository;
  readonly progress: IProgressRepository;
  readonly dailyReports: IDailyReportRepository;
  readonly ai: IAiProvider;
  readonly auth: IAuthProvider;
  readonly prisma: PrismaClient;
}

/**
 * Get all wired services. All repositories are always available now that
 * Group D + Group K + Group O + Group U are complete.
 */
export function getServices(): Services {
  const c = getContainer();
  return {
    projects: c.projects,
    boq: c.boq,
    library: c.library,
    calculation: c.calculation,
    rateAnalysis: c.rateAnalysis,
    wbs: c.wbs,
    activities: c.activities,
    schedules: c.schedules,
    calendars: c.calendars,
    drawings: c.drawings,
    submittals: c.submittals,
    rfis: c.rfis,
    correspondence: c.correspondence,
    payments: c.payments,
    variations: c.variations,
    progress: c.progress,
    dailyReports: c.dailyReports,
    ai: c.ai,
    auth: c.auth,
    prisma: c.prisma,
  };
}
