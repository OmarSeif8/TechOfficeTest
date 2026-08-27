/**
 * GET  /api/drawings/[id]/revisions — list revisions + events for a drawing.
 * POST /api/drawings/[id]/revisions — add a revision.
 *
 * Per SPEC_PHASE3_WEB.md §5 + §6 (S17 Drawing register → revision drawer).
 *
 * Per BR-DC3: a new revision REQUIRES an attached file (`fileUploadId`). The
 *           API route enforces non-null on POST (the schema is permissive but
 *           we 400 if absent).
 * Per BR-DC3: adding rev N+1 auto-supersedes the current revision. The new
 *           revision starts as ISSUED. This is implemented by:
 *             1. Calling nextRevisionLetter(currentRevisionLetter) to compute
 *                the new letter ("A" → "B", "Z" → "AA", ...).
 *             2. Calling applyRevisionSuperseded(currentRev, newRev) to get
 *                { oldStatus: SUPERSEDED, newStatus: ISSUED }.
 *             3. In a single transaction (via the services.prisma client):
 *                - INSERT the new revision with status=ISSUED.
 *                - If there was a previous current revision, UPDATE its
 *                  status to SUPERSEDED.
 *                - UPDATE the drawing's currentRevisionId to the new revision.
 *                - INSERT DrawingRevisionEvent rows for both REVISION_ADDED
 *                  (on new rev) and SUPERSEDED (on old rev) — BR-DC8.
 *
 * Per BR-WEB-5: verify the drawing's project is owned by the session user.
 * Per BR-WEB-8: POST writes AuditLog.
 * Per BR-WEB-11: POST body validated with zod (DrawingRevisionInputSchema,
 *           stripped of drawingId + createdByUserId — those come from the URL
 *           and the session).
 */

import { db } from "@/lib/db";
import {
  withErrorHandler,
  json,
  created,
  notFound,
  badRequest,
  writeAuditLog,
} from "@/lib/api-helpers";
import { requireUserId } from "@/lib/auth";
import { getServices } from "@/lib/services";
import { verifyProjectOwnership } from "@/app/api/_lib/boq-helpers";
import { DrawingRevisionInputSchema } from "@shared/schemas/doccontrol/entities";
import { nextRevisionLetter } from "@domain/doccontrol/numbering";
import { applyRevisionSuperseded } from "@domain/doccontrol/status-workflow";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// ─── GET list ─────────────────────────────────────────────────────────────

export const GET = withErrorHandler(async (_req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const services = getServices();

  const drawing = await services.drawings.getById(id);
  if (!drawing) return notFound("Drawing not found");

  const project = await verifyProjectOwnership(drawing.projectId, userId);
  if (!project) return notFound("Drawing not found");

  const [revisions, events] = await Promise.all([
    services.drawings.listRevisions(id),
    services.drawings.listEvents(id),
  ]);

  return json({ drawing, revisions, events });
});

// ─── POST add revision ────────────────────────────────────────────────────

export const POST = withErrorHandler(async (req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const services = getServices();

  const drawing = await services.drawings.getById(id);
  if (!drawing) return notFound("Drawing not found");

  const project = await verifyProjectOwnership(drawing.projectId, userId);
  if (!project) return notFound("Drawing not found");

  const body = await req.json();
  // Strip drawingId + createdByUserId — the URL + session are the sources of truth.
  const {
    drawingId: _ignoredDrawing,
    createdByUserId: _ignoredUser,
    revision: _ignoredRev,
    status: _ignoredStatus,
    ...rest
  } = body as Record<string, unknown>;
  const input = DrawingRevisionInputSchema.parse({
    ...rest,
    drawingId: id,
    createdByUserId: userId,
    // revision + status are computed by the domain — left undefined here so
    // the route can fill them in below.
    revision: "A",
    status: "ISSUED",
  });

  // BR-DC3: new revision requires an attached file.
  if (!input.fileUploadId) {
    return badRequest("fileUploadId is required for new revisions (BR-DC3)");
  }

  // Determine the current revision letter (if any) and compute the next one.
  let currentRevisionLetter: string | null = null;
  let currentRevisionRow: { id: string; revision: string; status: string } | null = null;
  if (drawing.currentRevisionId) {
    const currentRow = await db.drawingRevision.findUnique({
      where: { id: drawing.currentRevisionId },
    });
    if (currentRow) {
      currentRevisionLetter = currentRow.revision;
      currentRevisionRow = {
        id: currentRow.id,
        revision: currentRow.revision,
        status: currentRow.status,
      };
    }
  }

  const newRevisionLetter = nextRevisionLetter(currentRevisionLetter);
  const supersedeResult = applyRevisionSuperseded(
    currentRevisionLetter ?? "",
    newRevisionLetter,
  );

  // Run the full supersede operation in a single transaction:
  //   1. INSERT new revision (status=ISSUED per applyRevisionSuperseded).
  //   2. If there was a current revision, UPDATE its status to SUPERSEDED.
  //   3. UPDATE the drawing's currentRevisionId to the new revision.
  //   4. INSERT DrawingRevisionEvent rows (BR-DC8):
  //        - REVISION_ADDED on the new revision.
  //        - SUPERSEDED on the old revision (if any).
  const newRevision = await db.$transaction(async (tx) => {
    const created = await tx.drawingRevision.create({
      data: {
        drawingId: id,
        revision: newRevisionLetter,
        status: supersedeResult.newStatus,
        revisionDate: input.revisionDate,
        fileUploadId: input.fileUploadId,
        notes: input.notes ?? null,
        createdByUserId: userId,
      },
    });

    if (currentRevisionRow) {
      await tx.drawingRevision.update({
        where: { id: currentRevisionRow.id },
        data: { status: supersedeResult.oldStatus },
      });

      await tx.drawingRevisionEvent.create({
        data: {
          drawingId: id,
          revisionId: currentRevisionRow.id,
          eventType: "SUPERSEDED",
          fromStatus: currentRevisionRow.status as never,
          toStatus: supersedeResult.oldStatus,
          note: `Superseded by revision ${newRevisionLetter}`,
          eventDate: input.revisionDate,
          createdByUserId: userId,
        },
      });
    }

    await tx.drawing.update({
      where: { id },
      data: { currentRevisionId: created.id },
    });

    await tx.drawingRevisionEvent.create({
      data: {
        drawingId: id,
        revisionId: created.id,
        eventType: "REVISION_ADDED",
        fromStatus: null,
        toStatus: supersedeResult.newStatus,
        note: `Revision ${newRevisionLetter} added`,
        eventDate: input.revisionDate,
        createdByUserId: userId,
      },
    });

    return created;
  });

  await writeAuditLog({
    action: "drawing.revision.add",
    entityType: "DrawingRevision",
    entityId: newRevision.id,
    afterJson: {
      drawingId: id,
      revision: newRevisionLetter,
      previousRevisionId: currentRevisionRow?.id ?? null,
    },
  });

  return created(newRevision);
});
