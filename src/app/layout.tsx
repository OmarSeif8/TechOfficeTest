import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/theme-provider";
import { Providers } from "@/components/providers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";

// Linear's typography: Linear Display (custom) for headlines, Linear Text for body.
// Closest free equivalent: Inter (geometric sans, near-Linear Text metrics).
// SF Pro Display is the fallback on Apple devices (per DESIGN.md).
const inter = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "TechOffice — Engineering Technical Office",
  description:
    "Bilingual (EN/AR) project management and BoQ builder for civil engineers. Bill of Quantities, rate analysis, takeoff calculators, and Excel/PDF export.",
  keywords: [
    "TechOffice",
    "civil engineering",
    "BoQ",
    "Bill of Quantities",
    "rate analysis",
    "takeoff",
    "construction management",
  ],
  authors: [{ name: "TechOffice" }],
  icons: {
    icon: "/favicon.ico",
  },
  openGraph: {
    title: "TechOffice — Engineering Technical Office",
    description:
      "Bilingual (EN/AR) project management and BoQ builder for civil engineers.",
    siteName: "TechOffice",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "TechOffice — Engineering Technical Office",
    description:
      "Bilingual (EN/AR) project management and BoQ builder for civil engineers.",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // WO-W-13: read locale + messages from the next-intl request config
  // (src/i18n/request.ts). For Phase 1 the request config hardcodes "en"
  // until auth+settings integration lands in WO-W-14.
  const locale = await getLocale();
  const messages = await getMessages();
  const dir = locale === "ar" ? "rtl" : "ltr";

  return (
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          <NextIntlClientProvider messages={messages}>
            <Providers>{children}</Providers>
          </NextIntlClientProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
