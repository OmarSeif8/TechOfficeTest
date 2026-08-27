/**
 * Projects API — list (GET) + create (POST).
 *
 * Routes:
 *   GET  /api/projects            → list the authenticated user's projects
 *   POST /api/projects            → create a new project owned by the user
 *
 * Layer purity: top of the stack — App Router route handlers. May import
 * anything below (services, auth, shared schemas).
 *
 * Per CONSTITUTION_V1.1_WEB:
 *   - BR-WEB-4: optimistic concurrency on mutations (POST has no version check,
 *               but PATCH/DELETE on /api/projects/[id] do).
 *   - BR-WEB-5: cross-user access → 404 (don't leak existence). On GET /list,
 *               we filter by `ownerId = session.userId` so the user only ever
 *               sees their own projects — no 404 path needed for list.
 *   - BR-WEB-8: every mutation writes an AuditLog entry.
 *   - BR-WEB-11: server-side input validation via zod.
 */

import {
  withErrorHandler,
  json,
  created,
  writeAuditLog,
} from "@/lib/api-helpers";
import { requireUserId } from "@/lib/auth";
import { getServices } from "@/lib/services";
import { db } from "@/lib/db";
import Decimal from "decimal.js";
import { computeDocumentTotals } from "@domain/boq/totals";
import {
  ProjectCreateSchema,
  ProjectListQuerySchema,
} from "@/shared/schemas/project";

// ─── GET /api/projects ───────────────────────────────────────────────────

/**
 * List the authenticated user's projects. Optional query params:
 *   - search: substring filter (matched against name/client/contractNo fields)
 *   - limit:  page size (1-100, default 20)
 *   - offset: pagination offset (>=0, default 0)
 *
 * Returns: { data: Array<Project & { documentCount, itemCount, grandTotal }>, total: number }
 *
 * The `ownerId` filter is forced from the session — a user can never list
 * another user's projects, regardless of what query string they send.
 *
 * Each project includes aggregated totals computed server-side via the pure
 * domain function `computeDocumentTotals` (BR-3). This is the architecture
 * proof: domain code runs in the Next.js server without modification.
 */
export const GET = withErrorHandler(async (req: Request) => {
  const userId = await requireUserId();
  const services = getServices();

  // Parse + validate query string. zod's coerce handles string→number.
  const url = new URL(req.url);
  const query = ProjectListQuerySchema.parse({
    search: url.searchParams.get("search") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
  });

  const listOptions = {
    ownerId: userId,
    search: query.search,
    limit: query.limit,
    offset: query.offset,
    // includeDeleted: false (default) — soft-deleted rows hidden from list.
  };

  const [projects, total] = await Promise.all([
    services.projects.list(listOptions),
    services.projects.count(listOptions),
  ]);

  // Compute aggregated totals per project (documentCount, itemCount, grandTotal)
  // by fetching the BoQ document tree and running computeDocumentTotals.
  const data = await Promise.all(
    projects.map(async (p) => {
      const documents = await db.boQDocument.findMany({
        where: { projectId: p.id, deletedAt: null },
        include: {
          sections: {
            where: { deletedAt: null },
            include: {
              items: {
                where: { deletedAt: null },
                select: { quantity: true, rate: true, itemType: true },
              },
            },
          },
        },
      });

      const grandTotal = documents.reduce((sum, doc) => {
        const totals = computeDocumentTotals({
          sections: doc.sections.map((s) => ({
            id: s.id,
            code: s.code ?? undefined,
            items: s.items.map((i) => ({
              itemType: i.itemType as
                | "RATE_BASED"
                | "LUMP_SUM"
                | "PROVISIONAL_SUM"
                | "DAYWORK"
                | "UNIT_ONLY",
              quantity: i.quantity,
              rate: i.rate,
            })),
          })),
        });
        return sum.plus(totals.totalIncludingVat);
      }, new Decimal(0));

      const itemCount = documents.reduce(
        (sum, doc) => sum + doc.sections.reduce((s, sec) => s + sec.items.length, 0),
        0,
      );

      return {
        ...p,
        documentCount: documents.length,
        itemCount,
        grandTotal: grandTotal.toFixed(2),
      };
    }),
  );

  return json({ data, total });
});

// ─── POST /api/projects ──────────────────────────────────────────────────

/**
 * Create a new project. The `ownerId` is forced from the session — it is
 * NOT accepted from the request body (BR-WEB-5: a user can only create
 * projects they own). If the body contains an `ownerId` field, it is
 * silently ignored (zod's strict-mode default would reject unknown keys;
 * we use the default non-strict mode here, so unknown keys are stripped
 * during parse).
 *
 * On success: 201 Created with the new project + AuditLog entry.
 */
export const POST = withErrorHandler(async (req: Request) => {
  const userId = await requireUserId();
  const services = getServices();

  const body = await req.json();
  const input = ProjectCreateSchema.parse(body);

  // Compose the full create input — ownerId from session, everything else
  // from the validated body.
  const project = await services.projects.create({
    ownerId: userId,
    nameEn: input.nameEn,
    nameAr: input.nameAr,
    clientEn: input.clientEn,
    clientAr: input.clientAr,
    locationEn: input.locationEn,
    locationAr: input.locationAr,
    contractNo: input.contractNo,
    currency: input.currency,
  });

  // BR-WEB-8: audit log on every mutation. Best-effort — failure here
  // does not roll back the create (audit logging is observability, not
  // a transaction participant; if atomicity is required, wrap create +
  // audit in a Prisma $transaction inside the repository).
  await writeAuditLog({
    action: "project.create",
    entityType: "Project",
    entityId: project.id,
    afterJson: project,
  });

  return created(project);
});
