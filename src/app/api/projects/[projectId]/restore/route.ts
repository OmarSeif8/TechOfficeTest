/**
 * Projects API — restore a soft-deleted project.
 *
 * Route:
 *   POST /api/projects/[projectId]/restore → unset deletedAt (admin operation)
 *
 * Layer purity: top of the stack — App Router route handlers. May import
 * anything below (services, auth, shared schemas).
 *
 * Per CONSTITUTION_V1.1_WEB:
 *   - BR-WEB-5: cross-user access → 404 (don't leak existence). Ownership is
 *               enforced BEFORE the restore: we fetch the project with
 *               `includeDeleted=true` and compare ownerId to session.userId.
 *               A non-owner (or a non-existent id) gets 404.
 *   - BR-WEB-8: writes AuditLog entry on success (before + after snapshots).
 *
 * "Admin operation" semantics (per task spec WO-W-9):
 *   The repository's `restore()` does NOT version-check (the spec says "admin
 *   operation, unsets deletedAt"). There is no `requireAdmin()` helper in the
 *   codebase yet, so we currently allow ANY authenticated user to restore
 *   their OWN soft-deleted project. A future hardening task should add an
 *   admin-role check (e.g., `requireAdmin()` that throws "FORBIDDEN" if the
 *   session user's role is not "ADMIN") and apply it here. This is tracked as
 *   a deferred deviation in the task report.
 *
 * Slug name: this route uses `[projectId]` (not `[id]`) to match the sibling
 * routes under `/api/projects/[projectId]/...` (Next.js requires all sibling
 * dynamic segments to share a slug name).
 */

import {
  withErrorHandler,
  json,
  notFound,
  writeAuditLog,
} from "@/lib/api-helpers";
import { requireUserId } from "@/lib/auth";
import { getServices } from "@/lib/services";

// ─── Route handler context type ──────────────────────────────────────────
//
// In Next.js 15+ / 16, the second arg to a dynamic-route handler is a
// context object whose `params` is a Promise. We `await params` inside
// each handler.
interface RouteContext {
  params: Promise<{ projectId: string }>;
}

// ─── POST /api/projects/[projectId]/restore ───────────────────────────────

/**
 * Restore a soft-deleted project. The repository's `restore()` does NOT
 * version-check (it's an admin operation per the spec); it simply unsets
 * `deletedAt`. Returns the restored project on success, or null if the id
 * doesn't exist (or was never deleted).
 *
 * Ownership is enforced BEFORE the restore call: we fetch the project with
 * `includeDeleted=true` and compare ownerId to the session. A non-owner
 * (or a non-existent id) gets 404 — preserving BR-WEB-5's "don't leak
 * existence" rule.
 *
 * The body is intentionally empty — restore takes no parameters. We do not
 * require an `expectedVersion` (restore is not a concurrency-controlled
 * mutation per the spec).
 *
 * AuditLog: before (soft-deleted state) + after (restored state) snapshots,
 * but ONLY when an actual restore occurred (i.e., the project was previously
 * soft-deleted). If the project was already live, the operation is a no-op
 * and we don't write an audit entry.
 */
export const POST = withErrorHandler(
  async (_req: Request, ctx: RouteContext) => {
    const userId = await requireUserId();
    const services = getServices();
    const { projectId } = await ctx.params;

    // Pre-fetch with includeDeleted=true so we can:
    //   (a) verify the project exists at all,
    //   (b) verify ownership (BR-WEB-5),
    //   (c) capture the before-snapshot for audit (the tombstoned row).
    //
    // We can't use the shared `verifyProjectOwnership` helper here because
    // that helper calls `getById(id)` without `includeDeleted=true`, so it
    // would return null for soft-deleted rows — and restore's whole purpose
    // is to operate on soft-deleted rows. We inline the ownership check
    // instead, with `includeDeleted=true`.
    const before = await services.projects.getById(projectId, true);
    if (!before || before.ownerId !== userId) {
      return notFound("Project not found");
    }

    // If the project is NOT currently soft-deleted, the spec is ambiguous:
    // should we 409 ("nothing to restore") or 200 with the unchanged row?
    // The repository returns the unchanged row in this case (see
    // PrismaProjectRepository.restore — it re-reads and returns the live
    // row when count=0 because the row was never deleted). We mirror that:
    // return 200 with the project. No audit-log entry is written when the
    // row was already live (the operation was a no-op).
    const wasSoftDeleted = before.deletedAt !== null;

    const restored = await services.projects.restore(projectId);
    if (!restored) {
      // Shouldn't happen (we just confirmed existence above), but defensive.
      return notFound("Project not found");
    }

    if (wasSoftDeleted) {
      // BR-WEB-8: audit log only when an actual mutation occurred.
      await writeAuditLog({
        action: "project.restore",
        entityType: "Project",
        entityId: projectId,
        beforeJson: before,
        afterJson: restored,
      });
    }

    return json(restored);
  },
);
