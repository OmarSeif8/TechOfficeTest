/**
 * POST /api/submittals/[id]/status — change the workflow status of a submittal.
 *
 * Per SPEC_PHASE3_WEB.md §5 + §6 (S18 Submittals log → status-change actions).
 *
 * Per BR-DC5: status transitions are validated against the canTransitionSubmittalStatus
 *           table. An illegal transition → 422 Unprocessable Entity.
 * Per BR-DC6: if the transition is REVISE_RESUBMIT → SUBMITTED (a resubmission),
 *           the route bumps resubmissionNo + 1 and resets submittedDate to the
 *           event date (the new submission date).
 * Per BR-DC8: every status change writes an append-only SubmittalEvent row.
 *
 * Per BR-WEB-4: optimistic concurrency via expectedVersion in the body.
 * Per BR-WEB-5: verify the submittal's project is owned by the session user.
 * Per BR-WEB-8: writes AuditLog.
 * Per BR-WEB-11: body validated with zod.
 *
 * Body: { toStatus: SubmittalStatus, note?: string, eventDate: ISO yyyy-MM-dd,
 *         expectedVersion: number }
 *   - `eventDate` is the injected "today" (BR-DC1 — caller supplies the date,
 *     not Date.now()).
 *   - `expectedVersion` must match the current row's version.
 */

import { z } from "zod";
import {
  withErrorHandler,
  json,
  notFound,
  conflict,
  unprocessableEntity,
  writeAuditLog,
} from "@/lib/api-helpers";
import { requireUserId } from "@/lib/auth";
import { getServices } from "@/lib/services";
import { verifyProjectOwnership } from "@/app/api/_lib/boq-helpers";
import { SubmittalStatusSchema } from "@shared/schemas/doccontrol/entities";
import { canTransitionSubmittalStatus } from "@domain/doccontrol/status-workflow";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const StatusChangeSchema = z.object({
  toStatus: SubmittalStatusSchema,
  note: z.string().nullable().optional(),
  eventDate: z.string().regex(ISO_DATE_RE, "expected ISO yyyy-MM-dd"),
  expectedVersion: z.number().int().positive(),
});

export const POST = withErrorHandler(async (req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const services = getServices();

  const before = await services.submittals.getById(id);
  if (!before) return notFound("Submittal not found");

  const project = await verifyProjectOwnership(before.projectId, userId);
  if (!project) return notFound("Submittal not found");

  const body = await req.json();
  const input = StatusChangeSchema.parse(body);

  // Validate the transition via the pure domain function (architecture proof).
  if (!canTransitionSubmittalStatus(before.status, input.toStatus)) {
    return unprocessableEntity(
      `Illegal status transition: ${before.status} → ${input.toStatus}`,
    );
  }

  // ─── Resubmission handling (BR-DC5, GT-DC4) ───
  // REVISE_RESUBMIT → SUBMITTED is a resubmission: bump resubmissionNo,
  // reset submittedDate to the new eventDate (new submission cycle).
  // The ref stays the same across resubmissions (BR-DC2).
  const isResubmission =
    before.status === "REVISE_RESUBMIT" && input.toStatus === "SUBMITTED";

  const result = await services.submittals.update(id, {
    status: input.toStatus,
    submittedDate: isResubmission ? input.eventDate : undefined,
    resubmissionNo: isResubmission ? before.resubmissionNo + 1 : undefined,
    expectedVersion: input.expectedVersion,
  });

  if (result.kind === "not_found") return notFound("Submittal not found");
  if (result.kind === "conflict") {
    return conflict(
      "Submittal was modified by another user. Please reload and try again.",
      result.currentVersion,
    );
  }

  // ─── Append-only event row (BR-DC8) ───
  const event = await services.submittals.addEvent({
    submittalId: id,
    fromStatus: before.status,
    toStatus: input.toStatus,
    note: input.note ?? null,
    eventDate: input.eventDate,
    createdByUserId: userId,
  });

  await writeAuditLog({
    action: "submittal.status.change",
    entityType: "Submittal",
    entityId: id,
    beforeJson: { status: before.status, resubmissionNo: before.resubmissionNo },
    afterJson: {
      status: result.submittal.status,
      resubmissionNo: result.submittal.resubmissionNo,
      event,
    },
  });

  return json({ submittal: result.submittal, event });
});
