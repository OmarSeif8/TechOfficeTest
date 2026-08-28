import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Tell next-intl where the request config lives (src/i18n/request.ts).
// Required by next-intl v4 to resolve getMessages() / getLocale() in
// server components. Spec ref: WO-W-13 (i18n setup).
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default withNextIntl(nextConfig);
