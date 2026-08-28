import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Auto-sanitizes the database URL to guarantee connectivity:
 * 1. Corrects Supabase cluster hostname aws-0 to aws-1 for eu-west-1
 * 2. Strips accidental square brackets in password ([pass] -> pass)
 * 3. URL-encodes special characters in password (like @ -> %40)
 */
function getSanitizedDatabaseUrl(): string | undefined {
  let url = process.env.DATABASE_URL;
  if (!url) return undefined;

  // Fix cluster pooler host for Supabase eu-west-1
  if (url.includes("aws-0-eu-west-1.pooler.supabase.com")) {
    url = url.replace(
      "aws-0-eu-west-1.pooler.supabase.com",
      "aws-1-eu-west-1.pooler.supabase.com",
    );
  }

  // Strip accidental square brackets around password
  url = url.replace(/:\[(.*?)\]@/, ":$1@");

  // Fix unencoded special characters in password if present
  try {
    const parsed = new URL(url);
    if (
      parsed.password &&
      (parsed.password.includes("@") ||
        parsed.password.includes("[") ||
        parsed.password.includes("]"))
    ) {
      const cleanPass = parsed.password.replace(/^\[|\]$/g, "");
      parsed.password = encodeURIComponent(cleanPass);
      url = parsed.toString();
    }
  } catch {
    const match = url.match(/postgresql:\/\/([^:]+):([^@]+)@(.*)/);
    if (match) {
      const user = match[1];
      let pass = match[2].replace(/^\[|\]$/g, "");
      const rest = match[3];
      if (pass.includes("@")) {
        pass = encodeURIComponent(pass);
        url = `postgresql://${user}:${pass}@${rest}`;
      }
    }
  }

  return url;
}

const sanitizedUrl = getSanitizedDatabaseUrl();

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: sanitizedUrl ? { db: { url: sanitizedUrl } } : undefined,
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

globalForPrisma.prisma = db;