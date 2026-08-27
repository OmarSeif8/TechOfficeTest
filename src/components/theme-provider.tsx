"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * ThemeProvider — wraps next-themes for dark/light mode.
 * Per CONSTITUTION_V1.1_WEB Amendment #6 (Linear design language):
 *   - Dark mode is the default (Linear is dark-mode-native).
 *   - Light mode is supported but secondary.
 *   - No "system" mode — Linear users explicitly choose.
 */
export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
