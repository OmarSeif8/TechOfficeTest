/**
 * GET  /api/correspondence/[id]/transmittal-lines — list lines for a transmittal.
 * POST /api/correspondence/[id]/transmittal-lines — append a line to a transmittal.
 *
 * Per SPEC_PHASE3_WEB.md §5 + §6 (S20 Correspondence → transmittal builder).
 *
 * Per BR-DC10: a transmittal = a Correspondence row with type=TRANSMITTAL + N
 *           child TransmittalLine rows. The POST route 422-rejects if the
 *           parent Correspondence is not type=TRANSMITTAL.
 *
 * Per BR-DC10 (form footer): the GET route also returns the total copies
 *           across all lines (computed via the pure domain function
 *           calculateTotalCopies) — the architecture proof that the API
 *           route calls the pure domain function and returns its result.
 *
 * Per BR-WEB-5: verify the correspondence's project is owned by the session user.
 * Per BR-WEB-8: POST writes AuditLog.
 * Per BR-WEB-11: POST body validated with zod (TransmittalLineInputSchema).
 *
 * Note: transmittal lines have no `version` column — they are append-only /
 * removable. There is no optimistic concurrency here. The DELETE-method route
 * for a single line lives at /api/transmittal-lines/[id] (future work — not
 * in scope for Group P since the spec only requires list + add).
 */

import {
  withErrorHandler,
  json,
  created,
  notFound,
  unprocessableEntity,
  writeAuditLog,
} from "@/lib/api-helpers";
import { requireUserId } from "@/lib/auth";
import { getServices } from "@/lib/services";
import { verifyProjectOwnership } from "@/app/api/_lib/boq-helpers";
import { TransmittalLineInputSchema } from "@shared/schemas/doccontrol/entities";
import { calculateTotalCopies } from "@domain/doccontrol/transmittal";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// ─── GET list ─────────────────────────────────────────────────────────────

export const GET = withErrorHandler(async (_req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const services = getServices();

  const correspondence = await services.correspondence.getById(id);
  if (!correspondence) return notFound("Correspondence not found");

  const project = await verifyProjectOwnership(correspondence.projectId, userId);
  if (!project) return notFound("Correspondence not found");

  if (correspondence.type !== "TRANSMITTAL") {
    return unprocessableEntity(
      "Correspondence is not a transmittal (type=TRANSMITTAL required)",
    );
  }

  const lines = await services.correspondence.listTransmittalLines(id);

  // ─── Architecture proof: call the pure domain function ───
  // calculateTotalCopies sums copies across all lines (BR-DC10 form footer).
  const totalCopies = calculateTotalCopies(lines);

  return json({ lines, totalCopies });
});

// ─── POST add line ────────────────────────────────────────────────────────

export const POST = withErrorHandler(async (req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const services = getServices();

  const correspondence = await services.correspondence.getById(id);
  if (!correspondence) return notFound("Correspondence not found");

  const project = await verifyProjectOwnership(correspondence.projectId, userId);
  if (!project) return notFound("Correspondence not found");

  if (correspondence.type !== "TRANSMITTAL") {
    return unprocessableEntity(
      "Cannot add transmittal lines to a non-transmittal correspondence (type=TRANSMITTAL required)",
    );
  }

  const body = await req.json();
  // Strip transmittalId — the URL is the source of truth.
  const { transmittalId: _ignored, ...rest } = body as Record<string, unknown>;
  const input = TransmittalLineInputSchema.parse({ ...rest, transmittalId: id });

  const line = await services.correspondence.addTransmittalLine({
    transmittalId: id,
    docRef: input.docRef,
    descriptionEn: input.descriptionEn,
    descriptionAr: input.descriptionAr ?? null,
    copies: input.copies,
    sortOrder: input.sortOrder,
  });

  await writeAuditLog({
    action: "transmittal.line.add",
    entityType: "TransmittalLine",
    entityId: line.id,
    afterJson: { ...line, transmittalId: id },
  });

  return created(line);
});
