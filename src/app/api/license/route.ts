/**
 * License API — Phase 5.
 *
 * GET /api/license — returns the current user's license status
 * POST /api/license/start-trial — starts a 30-day PRO trial
 */

import { NextResponse } from "next/server";
import { checkLicense, startTrial } from "@/lib/license";
import { requireUserId } from "@/lib/auth";
import { writeAuditLog, withErrorHandler } from "@/lib/api-helpers";

export const GET = withErrorHandler(async () => {
  const userId = await requireUserId();
  const license = await checkLicense(userId);
  return NextResponse.json(license);
});

export const POST = withErrorHandler(async (req: Request) => {
  const userId = await requireUserId();
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  if (action === "start-trial" || req.method === "POST") {
    await startTrial(userId);
    await writeAuditLog({
      action: "license.trial-started",
      entityType: "Subscription",
      entityId: userId,
      afterJson: { plan: "PRO", status: "TRIAL", durationDays: 30 },
    });

    const license = await checkLicense(userId);
    return NextResponse.json(license, { status: 201 });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
});
