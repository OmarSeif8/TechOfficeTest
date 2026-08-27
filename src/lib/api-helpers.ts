/**
 * Shared API route helpers — used by all route handlers in src/app/api/.
 *
 * Provides consistent JSON responses, error handling, and audit logging.
 * Per CONSTITUTION_V1.1_WEB:
 *   - BR-WEB-5: All mutations require an authenticated session (use requireUserId)
 *   - BR-WEB-8: All mutations write to AuditLog
 *   - BR-WEB-11: Server-side input validation via zod
 *   - BR-WEB-12: Pure domain functions never touch the request/response cycle
 */

import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth";

// ─── JSON response helpers ────────────────────────────────────────────────

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export function created(body: unknown) {
  return NextResponse.json(body, { status: 201 });
}

export function noContent() {
  return new NextResponse(null, { status: 204 });
}

export function badRequest(message: string, details?: unknown) {
  return NextResponse.json(
    { error: message, details },
    { status: 400 },
  );
}

export function unauthorized(message = "Unauthorized") {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function forbidden(message = "Forbidden") {
  return NextResponse.json({ error: message }, { status: 403 });
}

export function notFound(message = "Not found") {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function conflict(message: string, currentVersion?: number) {
  return NextResponse.json(
    { error: message, currentVersion },
    { status: 409 },
  );
}

export function unprocessableEntity(message: string, details?: unknown) {
  return NextResponse.json(
    { error: message, details },
    { status: 422 },
  );
}

export function serverError(message = "Internal server error") {
  return NextResponse.json({ error: message }, { status: 500 });
}

// ─── Error handling wrapper ──────────────────────────────────────────────

/**
 * Wraps an async route handler with consistent error handling.
 * Catches ZodError → 400, "UNAUTHORIZED" → 401, known Error → 500.
 *
 * Usage:
 *   export const POST = withErrorHandler(async (req, ctx) => {
 *     const userId = await requireUserId();
 *     // ... handler logic
 *     return json({ success: true });
 *   });
 */
export function withErrorHandler<TArgs extends unknown[]>(
  handler: (...args: TArgs) => Promise<NextResponse>,
): (...args: TArgs) => Promise<NextResponse> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (err) {
      if (err instanceof ZodError) {
        return badRequest("Validation failed", err.issues);
      }
      if (err instanceof Error && err.message === "UNAUTHORIZED") {
        return unauthorized();
      }
      if (err instanceof Error && err.message === "FORBIDDEN") {
        return forbidden();
      }
      if (err instanceof Error && err.message === "NOT_FOUND") {
        return notFound();
      }
      console.error("[API Error]", err);
      return serverError(
        err instanceof Error ? err.message : "Unknown error",
      );
    }
  };
}

// ─── Audit logging (BR-WEB-8) ────────────────────────────────────────────

export interface AuditLogEntry {
  action: string; // e.g. "project.create", "boq.item.update"
  entityType: string; // e.g. "Project", "BoQItem"
  entityId: string;
  beforeJson?: unknown;
  afterJson?: unknown;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Writes an audit log entry. Best-effort — if it fails, the main mutation
 * still succeeds (audit logging is observability, not a transaction
 * participant). Use a Prisma $transaction if the audit MUST be atomic.
 */
export async function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    const userId = await requireUserId().catch(() => null);
    await db.auditLog.create({
      data: {
        actorUserId: userId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        beforeJson: entry.beforeJson
          ? JSON.stringify(entry.beforeJson)
          : null,
        afterJson: entry.afterJson
          ? JSON.stringify(entry.afterJson)
          : null,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
      },
    });
  } catch (err) {
    // Best-effort — log the failure but don't crash the request
    console.error("[AuditLog] Failed to write audit entry:", err);
  }
}
