import { AppSidebar } from "@/components/app-sidebar";
import { TopBar } from "@/components/top-bar";

/**
 * AppShell — the S1 layout shell wrapping all authenticated pages.
 *
 * Per SPEC_PHASE1_BOQ_WEB §3 (F1): "App shell & navigation, language toggle,
 * project switcher" — this is the structural shell (S1).
 *
 * Structure:
 *   - TopBar (sticky, h-12, hairline border)
 *   - Sidebar (w-56, surface-1 background, hairline border)
 *   - Main content area (scrollable)
 *   - Footer (sticky bottom per UI rules)
 *
 * This is a presentational component — it receives sidebar stats as props.
 * The page (server component) fetches the counts and passes them in.
 * This keeps AppShell free of @/lib/db imports (layer purity compliant).
 *
 * Per UI rules: footer is sticky to bottom when content is short, pushed
 * down naturally when content overflows. Implemented via flex-col + mt-auto.
 */
export interface AppShellProps {
  children: React.ReactNode;
  /** Sidebar footer stats (fetched server-side by the parent page) */
  sidebarStats?: {
    libraryItemCount: number;
    unitCount: number;
    rebarCount: number;
  };
}

export function AppShell({ children, sidebarStats }: AppShellProps) {
  const stats = sidebarStats ?? {
    libraryItemCount: 0,
    unitCount: 0,
    rebarCount: 0,
  };

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <TopBar />
      <div className="flex flex-1">
        <aside className="w-56 border-r border-border bg-card/50 flex flex-col hidden md:flex">
          <AppSidebar />
          <div className="p-3 border-t border-border text-xs text-muted-foreground space-y-1.5">
            <div className="flex justify-between">
              <span>Library items</span>
              <span className="font-mono">{stats.libraryItemCount}</span>
            </div>
            <div className="flex justify-between">
              <span>Units</span>
              <span className="font-mono">{stats.unitCount}</span>
            </div>
            <div className="flex justify-between">
              <span>Rebar diameters</span>
              <span className="font-mono">{stats.rebarCount}</span>
            </div>
          </div>
        </aside>
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
      <footer className="border-t border-border bg-card/50 px-4 py-2 text-xs text-muted-foreground flex items-center justify-between mt-auto">
        <div className="flex items-center gap-3">
          <span>TechOffice · Phase 1 (BoQ module)</span>
          <span>·</span>
          <span>Linear design language</span>
        </div>
        <div className="flex items-center gap-3">
          <span>EN / AR</span>
          <span>·</span>
          <span>Web MVP (Path C)</span>
        </div>
      </footer>
    </div>
  );
}
