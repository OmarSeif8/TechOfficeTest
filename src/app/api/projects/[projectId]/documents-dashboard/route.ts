/**
 * GET /api/projects/[projectId]/documents-dashboard — aggregate stats for S21.
 *
 * Per SPEC_PHASE3_WEB.md §6 (S21 Documents dashboard — widget cards linking
 * to filtered lists).
 *
 * Returns:
 *   - drawingsByStatus: count of drawings grouped by current revision status
 *     (PRELIMINARY, ISSUED, APPROVED_FOR_CONSTRUCTION, SUPERSEDED, OBSOLETE).
 *   - submittalsOverdue: count of submittals where isOverdue(asOf, dueDate,
 *     status, isFinal) === true.
 *   - submittalsOpen: count of submittals with a non-final status.
 *   - rfisOpen: count of RFIs with status=OPEN.
 *   - rfisOverdue: count of RFIs where isOverdue === true.
 *   - latestCorrespondence: the 5 most recent correspondence entries (by date).
 *
 * Per BR-DC1: `asOf` is the injected "today" — read from the `?asOf=` query
 *           parameter. Defaults to today's date (UTC midnight) if absent.
 *           (Date.now() is forbidden in src/domain/, but the API route is in
 *           src/app — it may use new Date() to compute the default asOf.)
 *
 * Per BR-DC6: overdue is computed via the pure domain function isOverdue —
 *           this is the architecture proof that the API route calls the pure
 *           domain function with the injected asOf.
 *
 * Per BR-WEB-5: verify the project exists AND is owned by the session user.
 */

import {
  withErrorHandler,
  json,
  notFound,
} from "@/lib/api-helpers";
import { requireUserId } from "@/lib/auth";
import { getServices } from "@/lib/services";
import { verifyProjectOwnership } from "@/app/api/_lib/boq-helpers";
import {
  isOverdue,
  calculateDueDate,
} from "@domain/doccontrol/overdue";
import {
  isFinalSubmittalStatus,
  isFinalRfiStatus,
} from "@domain/doccontrol/status-workflow";
import type {
  DrawingStatus,
  SubmittalStatus,
  RfiStatus,
} from "@shared/entities";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

function todayIsoUtc(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export const GET = withErrorHandler(async (req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { projectId } = await ctx.params;
  const services = getServices();

  const project = await verifyProjectOwnership(projectId, userId);
  if (!project) return notFound("Project not found");

  // ─── Injected clock (BR-DC1) ───
  // Read ?asOf= query parameter; default to today's UTC date.
  const url = new URL(req.url);
  const asOfParam = url.searchParams.get("asOf");
  const asOf = asOfParam && /^\d{4}-\d{2}-\d{2}$/.test(asOfParam)
    ? asOfParam
    : todayIsoUtc();

  // ─── Parallel fetch of all doc-control entities ───
  const [drawings, submittals, rfis, correspondences] = await Promise.all([
    services.drawings.list(projectId),
    services.submittals.list(projectId),
    services.rfis.list(projectId),
    services.correspondence.list(projectId),
  ]);

  // ─── Drawings: count by current revision status ───
  // We need the current revision's status, not the drawing's. Fetch each
  // drawing's current revision in parallel (small N in practice).
  const drawingsWithRev = await Promise.all(
    drawings.map(async (d) => {
      if (!d.currentRevisionId) return { drawing: d, currentStatus: null as DrawingStatus | null };
      const revs = await services.drawings.listRevisions(d.id);
      const current = revs.find((r) => r.id === d.currentRevisionId);
      return {
        drawing: d,
        currentStatus: current ? current.status : (null as DrawingStatus | null),
      };
    }),
  );

  const drawingsByStatus: Record<string, number> = {
    PRELIMINARY: 0,
    ISSUED: 0,
    APPROVED_FOR_CONSTRUCTION: 0,
    SUPERSEDED: 0,
    OBSOLETE: 0,
    NO_REVISION: 0,
  };
  for (const { currentStatus } of drawingsWithRev) {
    if (currentStatus === null) {
      drawingsByStatus.NO_REVISION += 1;
    } else {
      drawingsByStatus[currentStatus] = (drawingsByStatus[currentStatus] ?? 0) + 1;
    }
  }

  // ─── Submittals: open count + overdue count ───
  // Per BR-DC6: due date = submittedDate + reviewPeriodDays (calendar days).
  //   overdue ⇔ asOf > dueDate AND status is non-final AND status != DRAFT.
  let submittalsOverdue = 0;
  let submittalsOpen = 0;
  for (const s of submittals) {
    const isFinal = isFinalSubmittalStatus(s.status as SubmittalStatus);
    if (!isFinal && s.status !== "DRAFT") {
      submittalsOpen += 1;
    }
    if (s.submittedDate && !isFinal && s.status !== "DRAFT") {
      const dueDate = calculateDueDate(s.submittedDate, s.reviewPeriodDays);
      if (isOverdue(asOf, dueDate, s.status, isFinal)) {
        submittalsOverdue += 1;
      }
    }
  }

  // ─── RFIs: open count + overdue count ───
  let rfisOpen = 0;
  let rfisOverdue = 0;
  for (const r of rfis) {
    const isFinal = isFinalRfiStatus(r.status as RfiStatus);
    if (r.status === "OPEN") {
      rfisOpen += 1;
    }
    if (r.sentDate && !isFinal) {
      const dueDate = calculateDueDate(r.sentDate, r.reviewPeriodDays);
      if (isOverdue(asOf, dueDate, r.status, isFinal)) {
        rfisOverdue += 1;
      }
    }
  }

  // ─── Latest correspondence (top 5 by date desc) ───
  const latestCorrespondence = [...correspondences]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, 5);

  return json({
    asOf,
    drawings: {
      total: drawings.length,
      byStatus: drawingsByStatus,
    },
    submittals: {
      total: submittals.length,
      open: submittalsOpen,
      overdue: submittalsOverdue,
    },
    rfis: {
      total: rfis.length,
      open: rfisOpen,
      overdue: rfisOverdue,
    },
    correspondence: {
      total: correspondences.length,
      latest: latestCorrespondence,
    },
  });
});
