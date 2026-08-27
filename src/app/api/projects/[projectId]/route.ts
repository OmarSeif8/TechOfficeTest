/**
 * Projects API — single-project operations: GET / PATCH / DELETE.
 *
 * Routes:
 *   GET    /api/projects/[projectId]   → fetch a single project
 *   PATCH  /api/projects/[projectId]   → update with optimistic concurrency (BR-WEB-4)
 *   DELETE /api/projects/[projectId]   → soft-delete (sets deletedAt = now())
 *
 * Layer purity: top of the stack — App Router route handlers. May import
 * anything below (services, auth, shared schemas).
 *
 * Per CONSTITUTION_V1.1_WEB:
 *   - BR-WEB-4: optimistic concurrency — PATCH/DELETE body must include
 *               `expectedVersion`; the repository checks it atomically and
 *               returns { kind: "conflict", currentVersion } on mismatch.
 *   - BR-WEB-5: cross-user access → 404 (don't leak existence). Ownership is
 *               enforced via the shared `verifyProjectOwnership` helper — it
 *               returns null both when the project is missing AND when it
 *               belongs to another user, so the caller always returns 404.
 *   - BR-WEB-8: every mutation writes an AuditLog entry (with before+after
 *               on PATCH, before-only on DELETE since there is no "after").
 *   - BR-WEB-11: server-side input validation via zod.
 *
 * Slug name: this route uses `[projectId]` (not `[id]`) because Next.js
 * requires all sibling dynamic segments at the same path level to share a
 * slug name. The existing sibling routes `/api/projects/[projectId]/documents`
 * and `/api/projects/[projectId]/calculations` already use `[projectId]`, so
 * we follow suit. (The task spec wrote `[id]` — this is a justified deviation
 * to satisfy Next.js's router constraint; see the final report.)
 */

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
import {
  ProjectUpdateSchema,
  ProjectDeleteSchema,
} from "@/shared/schemas/project";
import type { Project } from "@/shared/entities";

// ─── Route handler context type ──────────────────────────────────────────
//
// In Next.js 15+ / 16, the second arg to a dynamic-route handler is a
// context object whose `params` is a Promise (params are async because
// they may depend on dynamic data sources like a CMS). We `await params`
// inside each handler.
interface RouteContext {
  params: Promise<{ projectId: string }>;
}

// ─── GET /api/projects/[projectId] ────────────────────────────────────────

/**
 * Fetch a single project by id.
 *
 * Returns 404 if the project doesn't exist, is soft-deleted, OR is owned by
 * a different user (BR-WEB-5: cross-user → 404 to avoid leaking existence).
 *
 * `verifyProjectOwnership` returns null in all three cases — the caller
 * can't distinguish "missing" from "not yours", which is the desired
 * behavior for BR-WEB-5.
 */
export const GET = withErrorHandler(
  async (_req: Request, ctx: RouteContext) => {
    const userId = await requireUserId();
    const { projectId } = await ctx.params;

    const project = await verifyProjectOwnership(projectId, userId);
    if (!project) {
      return notFound("Project not found");
    }

    return json(project);
  },
);

// ─── PATCH /api/projects/[projectId] ──────────────────────────────────────

/**
 * Update a project with optimistic concurrency (BR-WEB-4).
 *
 * Body: ProjectUpdateSchema — all project fields optional + `expectedVersion`
 * (required). The repository returns one of:
 *   { kind: "ok", project }         → 200 with updated project
 *   { kind: "not_found" }           → 404 (project vanished between fetch and update)
 *   { kind: "conflict", currentVersion } → 409 (version mismatch — caller should re-fetch)
 *
 * Ownership is checked BEFORE the update attempt (via verifyProjectOwnership).
 * This prevents a user from modifying another user's project even if they
 * guess the id + version.
 *
 * AuditLog: before + after snapshots are logged on success.
 */
export const PATCH = withErrorHandler(
  async (req: Request, ctx: RouteContext) => {
    const userId = await requireUserId();
    const services = getServices();
    const { projectId } = await ctx.params;

    // Pre-fetch for ownership check + before-snapshot for audit.
    // (Includes a tiny TOCTOU window — between this fetch and the update,
    // another writer could change/delete the row. The repository's
    // atomic version check is what actually guarantees correctness; this
    // fetch is purely for ownership enforcement + audit before-image.)
    const before = await verifyProjectOwnership(projectId, userId);
    if (!before) {
      return notFound("Project not found");
    }

    const body = await req.json();
    const input = ProjectUpdateSchema.parse(body);

    const result = await services.projects.update(projectId, {
      nameEn: input.nameEn,
      nameAr: input.nameAr,
      clientEn: input.clientEn,
      clientAr: input.clientAr,
      locationEn: input.locationEn,
      locationAr: input.locationAr,
      contractNo: input.contractNo,
      currency: input.currency,
      expectedVersion: input.expectedVersion,
    });

    if (result.kind === "not_found") {
      // Vanished between fetch and update — surface as 404 (don't leak
      // whether it ever existed to a different user).
      return notFound("Project not found");
    }
    if (result.kind === "conflict") {
      return conflict(
        "Project was modified by another user. Please refresh and retry.",
        result.currentVersion,
      );
    }

    // BR-WEB-8: audit log with before + after snapshots.
    await writeAuditLog({
      action: "project.update",
      entityType: "Project",
      entityId: projectId,
      beforeJson: before,
      afterJson: result.project,
    });

    return json(result.project);
  },
);

// ─── DELETE /api/projects/[projectId] ────────────────────────────────────

/**
 * Soft-delete a project. Sets `deletedAt = now()` and bumps `version`.
 * The project row stays in the DB (for audit / restore), but is hidden from
 * all default read paths.
 *
 * Body: ProjectDeleteSchema — `{ expectedVersion: number }`.
 *
 * Maps the repository's ProjectDeleteResult to:
 *   { kind: "ok" }                   → 204 No Content
 *   { kind: "not_found" }            → 404
 *   { kind: "conflict", currentVersion } → 409
 *
 * AuditLog: before-snapshot only (there is no meaningful "after" state —
 * the project is tombstoned; the deletedAt timestamp is set on the same row
 * we already captured).
 */
export const DELETE = withErrorHandler(
  async (req: Request, ctx: RouteContext) => {
    const userId = await requireUserId();
    const services = getServices();
    const { projectId } = await ctx.params;

    // Pre-fetch for ownership check + before-snapshot.
    const before = await verifyProjectOwnership(projectId, userId);
    if (!before) {
      return notFound("Project not found");
    }

    const body = await req.json();
    const input = ProjectDeleteSchema.parse(body);

    const result = await services.projects.softDelete(
      projectId,
      input.expectedVersion,
    );

    if (result.kind === "not_found") {
      return notFound("Project not found");
    }
    if (result.kind === "conflict") {
      return conflict(
        "Project was modified by another user. Please refresh and retry.",
        result.currentVersion,
      );
    }

    // BR-WEB-8: audit log with before-snapshot. No "after" — the project
    // is soft-deleted; the only diff is `deletedAt` (now) and `version` (+1),
    // which we don't bother re-fetching.
    await writeAuditLog({
      action: "project.delete",
      entityType: "Project",
      entityId: projectId,
      beforeJson: before satisfies Project,
    });

    return noContent();
  },
);
