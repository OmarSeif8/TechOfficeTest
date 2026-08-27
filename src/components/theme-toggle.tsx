"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

/**
 * ThemeToggle — switches between dark and light mode.
 *
 * Per CONSTITUTION_V1.1_WEB Amendment #6: dark mode is the default (Linear is
 * dark-mode-native). Light mode is supported but secondary.
 *
 * Uses next-themes (already wired in ThemeProvider). The toggle is a simple
 * icon button that flips between "dark" and "light".
 *
 * Client detection via useSyncExternalStore prevents hydration mismatch —
 * next-themes reads from localStorage which isn't available during SSR.
 * This is the React 18+ idiomatic pattern (avoids set-state-in-effect).
 */
const emptySubscribe = () => () => {};

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // Returns false during SSR, true on client — prevents hydration mismatch
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true, // client snapshot
    () => false, // server snapshot
  );

  if (!mounted) {
    // Placeholder with same dimensions to prevent layout shift
    return <div className="w-8 h-8" />;
  }

  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="w-8 h-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Light mode" : "Dark mode"}
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}
