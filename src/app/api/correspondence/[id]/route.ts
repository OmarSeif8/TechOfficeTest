/**
 * GET   /api/correspondence/[id] — fetch a single correspondence entry.
 * PATCH /api/correspondence/[id] — update with optimistic concurrency.
 * DELETE /api/correspondence/[id] — soft-delete with optimistic concurrency.
 *
 * Per SPEC_PHASE3_WEB.md §5 + §6 (S20 Correspondence).
 *
 * Per BR-WEB-5: every route verifies the correspondence's project is owned by
 *           the session user (missing-or-not-owned → 404).
 * Per BR-WEB-4: PATCH/DELETE take `expectedVersion` for optimistic concurrency.
 * Per BR-WEB-8: PATCH + DELETE write AuditLog entries.
 * Per BR-WEB-11: PATCH body validated with zod.
 *
 * Per BR-DC2: `ref` is immutable after creation — it cannot be PATCHed.
 *           Likewise `direction` is immutable (a letter cannot switch from
 *           INCOMING to OUTGOING — the sequences are independent).
 *
 * GET returns the correspondence + its transmittal lines (if type=TRANSMITTAL)
 * so the UI can render the transmittal builder with live preview (S20).
 */

import { z } from "zod";
import {
  withErrorHandler,
  json,
  notFound,
  conflict,
  noContent,
  writeAuditLog,
} from "@/lib/api-helpers";
import { requireUserId } from "@/lib/auth";
import { getServices } from "@/lib/services";
import { verifyProjectOwnership } from "@/app/api/_lib/boq-helpers";
import { CorrespondenceTypeSchema } from "@shared/schemas/doccontrol/entities";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const CorrespondenceUpdateSchema = z.object({
  type: CorrespondenceTypeSchema.optional(),
  date: z.string().regex(ISO_DATE_RE, "expected ISO yyyy-MM-dd").optional(),
  subjectEn: z.string().min(1).optional(),
  subjectAr: z.string().nullable().optional(),
  fromParty: z.string().optional(),
  toParty: z.string().optional(),
  bodyEn: z.string().nullable().optional(),
  bodyAr: z.string().nullable().optional(),
  expectedVersion: z.number().int().positive(),
});

const CorrespondenceDeleteSchema = z.object({
  expectedVersion: z.number().int().positive(),
});

// ─── GET single correspondence ─────────────────────────────────────────────

export const GET = withErrorHandler(async (_req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const services = getServices();

  const correspondence = await services.correspondence.getById(id);
  if (!correspondence) return notFound("Correspondence not found");

  const project = await verifyProjectOwnership(correspondence.projectId, userId);
  if (!project) return notFound("Correspondence not found");

  // If type=TRANSMITTAL, also return the lines (BR-DC10).
  const transmittalLines =
    correspondence.type === "TRANSMITTAL"
      ? await services.correspondence.listTransmittalLines(id)
      : [];

  return json({ correspondence, transmittalLines });
});

// ─── PATCH update (optimistic concurrency) ────────────────────────────────

export const PATCH = withErrorHandler(async (req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const services = getServices();

  const before = await services.correspondence.getById(id);
  if (!before) return notFound("Correspondence not found");

  const project = await verifyProjectOwnership(before.projectId, userId);
  if (!project) return notFound("Correspondence not found");

  const body = await req.json();
  const input = CorrespondenceUpdateSchema.parse(body);

  const result = await services.correspondence.update(id, {
    type: input.type,
    date: input.date,
    subjectEn: input.subjectEn,
    subjectAr: input.subjectAr,
    fromParty: input.fromParty,
    toParty: input.toParty,
    bodyEn: input.bodyEn,
    bodyAr: input.bodyAr,
    expectedVersion: input.expectedVersion,
  });

  if (result.kind === "not_found") return notFound("Correspondence not found");
  if (result.kind === "conflict") {
    return conflict(
      "Correspondence was modified by another user. Please reload and try again.",
      result.currentVersion,
    );
  }

  await writeAuditLog({
    action: "correspondence.update",
    entityType: "Correspondence",
    entityId: id,
    beforeJson: before,
    afterJson: result.correspondence,
  });

  return json(result.correspondence);
});

// ─── DELETE soft-delete (optimistic concurrency) ──────────────────────────

export const DELETE = withErrorHandler(async (req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const services = getServices();

  const before = await services.correspondence.getById(id);
  if (!before) return notFound("Correspondence not found");

  const project = await verifyProjectOwnership(before.projectId, userId);
  if (!project) return notFound("Correspondence not found");

  let expectedVersion: number | undefined;
  try {
    const text = await req.text();
    if (text.trim().length > 0) {
      const body = CorrespondenceDeleteSchema.parse(JSON.parse(text));
      expectedVersion = body.expectedVersion;
    }
  } catch {
    // fall through to query string
  }
  if (expectedVersion === undefined) {
    const url = new URL(req.url);
    const q = url.searchParams.get("expectedVersion");
    if (q === null) {
      return conflict(
        "expectedVersion is required (body or ?expectedVersion=) for optimistic concurrency.",
        before.version,
      );
    }
    const n = Number.parseInt(q, 10);
    if (!Number.isFinite(n) || n <= 0) {
      return conflict("expectedVersion must be a positive integer.", before.version);
    }
    expectedVersion = n;
  }

  const result = await services.correspondence.softDelete(id, expectedVersion);

  if (result.kind === "not_found") return notFound("Correspondence not found");
  if (result.kind === "conflict") {
    return conflict(
      "Correspondence was modified by another user. Please reload and try again.",
      result.currentVersion,
    );
  }

  await writeAuditLog({
    action: "correspondence.delete",
    entityType: "Correspondence",
    entityId: id,
    beforeJson: before,
  });

  return noContent();
});
