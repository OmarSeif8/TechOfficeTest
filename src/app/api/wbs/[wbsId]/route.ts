/**
 * GET   /api/wbs/[wbsId] — fetch a single WBS node.
 * PATCH /api/wbs/[wbsId] — update a WBS node (code, nameEn, nameAr, sortOrder).
 * DELETE /api/wbs/[wbsId] — soft-delete a WBS node.
 *
 * Per SPEC_PHASE2_WEB.md §6 (S12 WBS Tree) and BR-WEB-P6.
 *
 * Per BR-WEB-5: every route verifies the node's project is owned by the
 *           session user (missing-or-not-owned → 404 to avoid leaking existence).
 * Per BR-WEB-8: PATCH + DELETE write AuditLog entries.
 * Per BR-WEB-11: PATCH body validated with zod (WbsNodeUpdateSchema).
 *
 * Note on optimistic concurrency: the WbsNode table per the spec has no
 * `version` column (Group K deviation). Therefore PATCH/DELETE do NOT do
 * version checks — they operate on (id, deletedAt=null). The repository's
 * `update`/`softDelete` return `{ kind: "not_found" }` for both "missing"
 * and "already tombstoned". The PATCH/DELETE body schema still accepts an
 * optional `expectedVersion` for forward compatibility — but it's ignored
 * today (kept off the wire-shape contract so callers don't need to change).
 *
 * `sortOrder` PATCH is included here (not via a separate reorder route) since
 * the spec for S12 mentions drag-reorder — the reorder-by-array endpoint is
 * a Group M concern; this single-node PATCH is enough for editing fields.
 */

import {
  withErrorHandler,
  json,
  notFound,
  noContent,
  writeAuditLog,
  badRequest,
} from "@/lib/api-helpers";
import { requireUserId } from "@/lib/auth";
import { getServices } from "@/lib/services";
import { verifyProjectOwnership } from "@/app/api/_lib/boq-helpers";
import { WbsNodeUpdateSchema } from "@shared/schemas/scheduling/entities";

interface RouteContext {
  params: Promise<{ wbsId: string }>;
}

// ─── GET single node ─────────────────────────────────────────────────────

export const GET = withErrorHandler(async (_req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { wbsId } = await ctx.params;
  const services = getServices();

  const node = await services.wbs.getById(wbsId);
  if (!node) return notFound("WBS node not found");

  const project = await verifyProjectOwnership(node.projectId, userId);
  if (!project) return notFound("WBS node not found");

  return json(node);
});

// ─── PATCH update ────────────────────────────────────────────────────────

export const PATCH = withErrorHandler(async (req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { wbsId } = await ctx.params;
  const services = getServices();

  const before = await services.wbs.getById(wbsId);
  if (!before) return notFound("WBS node not found");

  const project = await verifyProjectOwnership(before.projectId, userId);
  if (!project) return notFound("WBS node not found");

  const body = await req.json();
  const input = WbsNodeUpdateSchema.parse(body);

  // Defensive: if a new parentId is provided, verify it belongs to this
  // project AND is not the node itself (would create a self-cycle) AND is
  // not a descendant of the node (would create a cycle). The descendant
  // check is done via the project's WBS list — small enough to walk.
  if (input.parentId !== undefined && input.parentId !== null) {
    if (input.parentId === wbsId) {
      return badRequest("A WBS node cannot be its own parent.");
    }
    const parent = await services.wbs.getById(input.parentId);
    if (!parent || parent.projectId !== before.projectId) {
      return notFound("Parent WBS node not found in this project");
    }
    // Cycle check: walk up from the proposed parent. If we hit `wbsId`,
    // it's a descendant — reject.
    const allNodes = await services.wbs.list(before.projectId);
    const byId = new Map(allNodes.map((n) => [n.id, n] as const));
    let cursor: string | null = input.parentId;
    const guard = new Set<string>();
    while (cursor) {
      if (cursor === wbsId) {
        return badRequest(
          "Cannot move a WBS node under one of its own descendants (cycle).",
        );
      }
      if (guard.has(cursor)) break; // shouldn't happen, but defensive
      guard.add(cursor);
      cursor = byId.get(cursor)?.parentId ?? null;
    }
  }

  const result = await services.wbs.update(wbsId, {
    parentId: input.parentId,
    code: input.code,
    nameEn: input.nameEn,
    nameAr: input.nameAr,
  });

  if (result.kind === "not_found") return notFound("WBS node not found");

  await writeAuditLog({
    action: "wbs.node.update",
    entityType: "WbsNode",
    entityId: wbsId,
    beforeJson: before,
    afterJson: result.node,
  });

  return json(result.node);
});

// ─── DELETE soft-delete ─────────────────────────────────────────────────

export const DELETE = withErrorHandler(async (_req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { wbsId } = await ctx.params;
  const services = getServices();

  const before = await services.wbs.getById(wbsId);
  if (!before) return notFound("WBS node not found");

  const project = await verifyProjectOwnership(before.projectId, userId);
  if (!project) return notFound("WBS node not found");

  const result = await services.wbs.softDelete(wbsId);
  if (result.kind === "not_found") return notFound("WBS node not found");

  await writeAuditLog({
    action: "wbs.node.delete",
    entityType: "WbsNode",
    entityId: wbsId,
    beforeJson: before,
  });

  return noContent();
});
