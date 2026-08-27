/**
 * GET  /api/projects/[projectId]/wbs — list WBS nodes (flat list; the UI builds
 *                                       the tree client-side from parentId).
 * POST /api/projects/[projectId]/wbs — create a WBS node.
 *
 * Per SPEC_PHASE2_WEB.md §6 (S12 WBS Tree) and BR-WEB-P6.
 *
 * Per BR-WEB-5: verify the project exists and is owned by the session user.
 * Per BR-WEB-8: POST writes AuditLog.
 * Per BR-WEB-11: POST body validated with zod (WbsNodeCreateSchema).
 *
 * `projectId` is injected from the URL — the body must NOT carry it (defense
 * in depth: even if the body says `projectId: "other"`, the URL wins).
 */

import {
  withErrorHandler,
  json,
  created,
  notFound,
  writeAuditLog,
} from "@/lib/api-helpers";
import { requireUserId } from "@/lib/auth";
import { getServices } from "@/lib/services";
import { verifyProjectOwnership } from "@/app/api/_lib/boq-helpers";
import { WbsNodeCreateSchema } from "@shared/schemas/scheduling/entities";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

// ─── GET list ────────────────────────────────────────────────────────────

/**
 * Returns the project's WBS nodes as a flat array, sorted by sortOrder asc
 * then createdAt asc. The UI builds the tree from `parentId` references.
 *
 * Soft-deleted nodes are excluded (the repository's default `includeDeleted`
 * is false).
 */
export const GET = withErrorHandler(async (_req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { projectId } = await ctx.params;
  const services = getServices();

  const project = await verifyProjectOwnership(projectId, userId);
  if (!project) return notFound("Project not found");

  const nodes = await services.wbs.list(projectId);
  return json({ nodes });
});

// ─── POST create ──────────────────────────────────────────────────────────

/**
 * Create a WBS node under this project.
 *
 * Body: WbsNodeCreateSchema (without projectId — the route injects it from
 * the URL):
 *   - code: required non-empty string
 *   - nameEn: required non-empty string
 *   - nameAr?: optional nullable string
 *   - parentId?: optional nullable string (must be an existing WBS node in
 *     this project — we do a defensive check below)
 *   - sortOrder?: integer (defaults to 0)
 *
 * Defensive: if `parentId` is provided, verify the parent belongs to this
 * project. A non-existent or cross-project parent → 400 (we don't want to
 * leak existence of another user's WBS node, but parentId is a cuid and the
 * URL already grants the project; we surface it as "Parent not found in
 * this project" rather than 404 to keep the API self-consistent).
 */
export const POST = withErrorHandler(async (req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { projectId } = await ctx.params;
  const services = getServices();

  const project = await verifyProjectOwnership(projectId, userId);
  if (!project) return notFound("Project not found");

  const body = await req.json();
  // Strip any projectId from the body — the URL is the source of truth.
  const { projectId: _ignored, ...rest } = body as Record<string, unknown>;
  const input = WbsNodeCreateSchema.parse({ ...rest, projectId });

  // Defensive: if a parentId is provided, verify it belongs to this project.
  if (input.parentId) {
    const parent = await services.wbs.getById(input.parentId);
    if (!parent || parent.projectId !== projectId) {
      return notFound("Parent WBS node not found in this project");
    }
  }

  const node = await services.wbs.create({
    projectId,
    parentId: input.parentId ?? null,
    code: input.code,
    nameEn: input.nameEn,
    nameAr: input.nameAr ?? null,
    sortOrder: input.sortOrder,
  });

  await writeAuditLog({
    action: "wbs.node.create",
    entityType: "WbsNode",
    entityId: node.id,
    afterJson: node,
  });

  return created(node);
});
