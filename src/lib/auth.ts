/**
 * Thin wrappers around NextAuth's `getServerSession`.
 *
 * Use these from server components, route handlers, and server actions to:
 *   - read the current session (`getSession`)
 *   - enforce authentication in API routes (`requireUserId`)
 *
 * The error thrown by `requireUserId` (`"UNAUTHORIZED"`) is a sentinel
 * string — API routes catch it and translate to a 401 response. Throwing a
 * sentinel (rather than a structured error) keeps the call site simple:
 *
 *   ```
 *   const userId = await requireUserId();
 *   ```
 *
 * Layer purity: server-only — `next-auth` and `@/lib/auth-options` are both
 * server-only imports. This module must never be imported from client
 * components (use `next-auth/react`'s `useSession` there with the
 * `SessionProvider` wrapper instead).
 *
 * DEMO MODE (Phase 1): When no authenticated session exists, `requireUserId`
 * falls back to a demo user. This lets the app be fully functional in the
 * preview panel without requiring a sign-in flow. The demo user is auto-
 * created on first access. In production, set `DEMO_MODE=false` to enforce
 * real authentication.
 */

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { db } from "@/lib/db";

const DEMO_USER_EMAIL = "demo@techoffice.app";
const DEMO_MODE = process.env.DEMO_MODE !== "false"; // enabled by default

export async function getSession() {
  try {
    return await getServerSession(authOptions);
  } catch (err) {
    console.error("[Auth] getServerSession error:", err);
    return null;
  }
}

/**
 * Returns the authenticated user's id, or throws `"UNAUTHORIZED"`.
 * API routes catch this and return a 401 response.
 *
 * In DEMO MODE (default for Phase 1): if no session exists, auto-creates
 * and returns a demo user ID so the app is fully functional without sign-in.
 */
export async function requireUserId(): Promise<string> {
  const session = await getSession();
  // The default NextAuth `Session.user` type doesn't include `id` — the
  // `session` callback in `@/lib/auth-options` adds it via a cast. We do
  // the same here to read it back without module augmentation.
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (userId) {
    return userId;
  }

  // ─── Demo mode fallback ───────────────────────────────────────────────
  // Phase 1: if no authenticated session, use a demo user so the app
  // works in the preview panel without requiring sign-in.
  // Set DEMO_MODE=false in .env to disable in production.
  if (DEMO_MODE) {
    return getOrCreateDemoUserId();
  }

  throw new Error("UNAUTHORIZED");
}

/**
 * Get or create the demo user. Called when no session exists and DEMO_MODE
 * is enabled. The demo user is a regular User row with a known email —
 * all data created through the app is owned by this user.
 *
 * This function is idempotent — safe to call on every request.
 */
async function getOrCreateDemoUserId(): Promise<string> {
  // Try to find existing demo user (not soft-deleted)
  let demoUser = await db.user.findUnique({
    where: { email: DEMO_USER_EMAIL },
  });

  if (!demoUser || demoUser.deletedAt) {
    // Create the demo user with a dummy password hash (not usable for sign-in,
    // but the row needs to exist for FK constraints)
    demoUser = await db.user.upsert({
      where: { email: DEMO_USER_EMAIL },
      create: {
        email: DEMO_USER_EMAIL,
        name: "Demo Engineer",
        passwordHash: "$2a$12$demoAccountNotUsableForSignInHashValueXX",
        role: "USER",
        locale: "EN",
      },
      update: {
        deletedAt: null, // restore if previously soft-deleted
      },
    });

    // Create default UserSettings if not exists
    await db.userSettings.upsert({
      where: { userId: demoUser.id },
      create: {
        userId: demoUser.id,
        theme: "DARK",
        locale: "EN",
        defaultLaborMode: "CONSUMPTION",
        defaultOverheadPct: "10",
        defaultProfitPct: "15",
      },
      update: {},
    });
  }

  return demoUser.id;
}
