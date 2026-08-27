/**
 * License verification — Phase 5 (Commercial Hardening).
 *
 * Per SPEC_PHASE4_WEB.md + SPEC 5:
 * - Trial: 30 days from first run (TRIAL status)
 * - Active: paid subscription (ACTIVE status)
 * - Expired/overdue: PAST_DUE → read-only mode
 * - Canceled: CANCELED → read-only mode
 *
 * Web adaptation: uses DB Subscription row instead of Ed25519 signed file
 * (desktop-only pattern). For web SaaS, the server checks the Subscription
 * row on every authenticated request.
 *
 * Per Constitution §3: "Data is never hostage" — expired users can still
 * VIEW and EXPORT their data. They just can't EDIT.
 */

import { db } from "@/lib/db";

export interface LicenseCheckResult {
  status: "trial" | "active" | "expired" | "canceled" | "free";
  plan: "FREE" | "PRO" | "ENTERPRISE";
  canEdit: boolean;
  canView: boolean;
  daysRemaining: number | null; // null for non-trial
  trialEndsAt: Date | null;
  message: string;
}

const TRIAL_DURATION_DAYS = 30;

/**
 * Check the current user's license/subscription status.
 * Called by API routes to enforce edit/view permissions.
 */
export async function checkLicense(userId: string): Promise<LicenseCheckResult> {
  const subscription = await db.subscription.findUnique({
    where: { userId },
  });

  // No subscription row → FREE plan, can view but limited editing
  if (!subscription) {
    return {
      status: "free",
      plan: "FREE",
      canEdit: true, // Phase 5 MVP: allow editing in free mode
      canView: true,
      daysRemaining: null,
      trialEndsAt: null,
      message: "Free plan — upgrade to Pro for scheduling + payments modules",
    };
  }

  const now = new Date();

  switch (subscription.status) {
    case "ACTIVE":
      return {
        status: "active",
        plan: subscription.plan,
        canEdit: true,
        canView: true,
        daysRemaining: null,
        trialEndsAt: null,
        message: `Active ${subscription.plan} subscription`,
      };

    case "TRIAL": {
      const trialStart = subscription.currentPeriodStart ?? subscription.createdAt;
      const trialEnd = new Date(trialStart);
      trialEnd.setDate(trialEnd.getDate() + TRIAL_DURATION_DAYS);

      const daysRemaining = Math.max(
        0,
        Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
      );

      if (now > trialEnd) {
        // Trial expired → read-only
        return {
          status: "expired",
          plan: subscription.plan,
          canEdit: false, // read-only
          canView: true, // data never hostage
          daysRemaining: 0,
          trialEndsAt: trialEnd,
          message: "Trial expired — upgrade to continue editing. Your data is safe and exportable.",
        };
      }

      return {
        status: "trial",
        plan: subscription.plan,
        canEdit: true,
        canView: true,
        daysRemaining,
        trialEndsAt: trialEnd,
        message: `Trial: ${daysRemaining} days remaining`,
      };
    }

    case "PAST_DUE":
      return {
        status: "expired",
        plan: subscription.plan,
        canEdit: false, // read-only
        canView: true,
        daysRemaining: null,
        trialEndsAt: null,
        message: "Subscription past due — please update payment. Read-only mode (data exportable).",
      };

    case "CANCELED":
      return {
        status: "canceled",
        plan: subscription.plan,
        canEdit: false, // read-only
        canView: true,
        daysRemaining: null,
        trialEndsAt: null,
        message: "Subscription canceled — read-only mode. Your data is safe and exportable.",
      };

    default:
      return {
        status: "free",
        plan: "FREE",
        canEdit: true,
        canView: true,
        daysRemaining: null,
        trialEndsAt: null,
        message: "Free plan",
      };
  }
}

/**
 * Start a trial for a new user. Called after sign-up.
 * Creates a Subscription row with status=TRIAL, plan=PRO (full access during trial).
 */
export async function startTrial(userId: string): Promise<void> {
  const now = new Date();
  const trialEnd = new Date(now);
  trialEnd.setDate(trialEnd.getDate() + TRIAL_DURATION_DAYS);

  await db.subscription.upsert({
    where: { userId },
    create: {
      userId,
      status: "TRIAL",
      plan: "PRO",
      currentPeriodStart: now,
      currentPeriodEnd: trialEnd,
    },
    update: {}, // don't overwrite if exists
  });
}

/**
 * Check if the user can access a specific module.
 * FREE: BoQ + Documents only
 * PRO: Everything (BoQ + Scheduling + Documents + Financials)
 * ENTERPRISE: Everything + future modules
 */
export function canAccessModule(
  plan: "FREE" | "PRO" | "ENTERPRISE",
  module: "boq" | "scheduling" | "documents" | "financials",
): boolean {
  if (plan === "ENTERPRISE" || plan === "PRO") return true;
  // FREE: BoQ + Documents only
  return module === "boq" || module === "documents";
}
