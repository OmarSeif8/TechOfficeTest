import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { ClientViewRouter } from "@/components/view-router";
import { AuthGate } from "@/components/auth-gate";

/**
 * Home page — the single / route for TechOffice.
 *
 * Per environment constraint: only the / route exists. All screens (S1-S10)
 * are rendered within this single-page app via view switching (Zustand
 * `currentView` state in the UI store).
 *
 * The page is a Server Component that:
 *   1. Checks if the user is authenticated (via NextAuth session)
 *   2. If authenticated: fetches sidebar stats + renders the AppShell with views
 *   3. If not authenticated: renders the AuthView (sign-in / sign-up)
 *
 * Demo mode: when DEMO_MODE=true (default for preview), unauthenticated
 * users get a demo session so the app is functional without sign-in.
 * Set DEMO_MODE=false in .env to require real authentication.
 */
export default async function Home() {
  // Check if there's an authenticated session
  const { getSession } = await import("@/lib/auth");
  const session = await getSession().catch(() => null);
  const isAuthenticated = !!session?.user;

  // If not authenticated, show the auth view (sign-in / sign-up)
  // Demo mode is handled in requireUserId at the API layer — the UI always
  // shows the auth gate so the user knows they can sign in for real.
  if (!isAuthenticated) {
    // Check if demo mode is enabled — if so, show the app anyway
    // (the API layer will auto-create a demo user)
    const demoMode = process.env.DEMO_MODE !== "false";
    if (!demoMode) {
      return <AuthGate />;
    }
    // Demo mode: show the app with a banner
  }

  // Fetch sidebar stats server-side (cheap counts, rarely change)
  const libraryItemCount = await db.itemLibrary.count({
    where: { scope: "APP_GLOBAL" },
  });
  const unitCount = await db.unit.count();
  const rebarCount = await db.rebarDiameter.count();

  return (
    <>
      {!isAuthenticated && (
        <div className="bg-[var(--linear-warning)]/10 border-b border-[var(--linear-warning)]/30 text-xs text-center py-1 px-4 text-[var(--linear-warning)]">
          Demo mode — sign in to save your work permanently
        </div>
      )}
      <AppShell
        sidebarStats={{ libraryItemCount, unitCount, rebarCount }}
      >
        <ClientViewRouter />
      </AppShell>
    </>
  );
}
