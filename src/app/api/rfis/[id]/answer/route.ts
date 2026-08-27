/**
 * POST /api/rfis/[id]/answer — record the answer to an RFI.
 *
 * Per SPEC_PHASE3_WEB.md §5 + §6 (S19 RFI log → answer detail).
 *
 * Per BR-DC7: answering sets answer text (EN/AR) + answer date AND transitions
 *           status to ANSWERED. ANSWERED is a terminal state for overdue
 *           purposes (BR-DC6 — see isFinalRfiStatus).
 * Per BR-DC8: the OPEN → ANSWERED transition writes an append-only RfiEvent.
 *
 * Per BR-WEB-4: optimistic concurrency via expectedVersion in the body.
 * Per BR-WEB-5: verify the RFI's project is owned by the session user.
 * Per BR-WEB-8: writes AuditLog.
 * Per BR-WEB-11: body validated with zod.
 *
 * Body: { answerEn: string, answerAr?: string|null, answerDate: ISO yyyy-MM-dd,
 *         expectedVersion: number }
 *
 * The transition legality (OPEN → ANSWERED or ANSWERED → ANSWERED to update)
 * is validated via the pure domain function canTransitionRfiStatus. An illegal
 * transition (e.g. CLOSED → ANSWERED) → 422.
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
import { canTransitionRfiStatus } from "@domain/doccontrol/status-workflow";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const AnswerSchema = z.object({
  answerEn: z.string().min(1),
  answerAr: z.string().nullable().optional(),
  answerDate: z.string().regex(ISO_DATE_RE, "expected ISO yyyy-MM-dd"),
  expectedVersion: z.number().int().positive(),
});

export const POST = withErrorHandler(async (req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const services = getServices();

  const before = await services.rfis.getById(id);
  if (!before) return notFound("RFI not found");

  const project = await verifyProjectOwnership(before.projectId, userId);
  if (!project) return notFound("RFI not found");

  const body = await req.json();
  const input = AnswerSchema.parse(body);

  // Validate the transition via the pure domain function.
  // OPEN → ANSWERED is always legal. ANSWERED → ANSWERED (re-answering to
  // update the answer) is also legal (it's a no-op transition).
  if (!canTransitionRfiStatus(before.status, "ANSWERED") && before.status !== "ANSWERED") {
    return unprocessableEntity(
      `Cannot answer an RFI in status ${before.status}`,
    );
  }

  // Atomic update: set answer text + answer date + status=ANSWERED.
  const result = await services.rfis.answer(id, {
    answerEn: input.answerEn,
    answerAr: input.answerAr ?? null,
    answerDate: input.answerDate,
    expectedVersion: input.expectedVersion,
  });

  if (result.kind === "not_found") return notFound("RFI not found");
  if (result.kind === "conflict") {
    return conflict(
      "RFI was modified by another user. Please reload and try again.",
      result.currentVersion,
    );
  }

  // ─── Append-only event row (BR-DC8) ───
  // If the RFI was already ANSWERED (re-answer to update), we still log the
  // event — the event log shows the latest answer date.
  const event = await services.rfis.addEvent({
    rfiId: id,
    fromStatus: before.status,
    toStatus: "ANSWERED",
    note: `Answered on ${input.answerDate}`,
    eventDate: input.answerDate,
    createdByUserId: userId,
  });

  await writeAuditLog({
    action: "rfi.answer",
    entityType: "Rfi",
    entityId: id,
    beforeJson: { status: before.status },
    afterJson: { status: result.rfi.status, answerDate: result.rfi.answerDate, event },
  });

  return json({ rfi: result.rfi, event });
});
