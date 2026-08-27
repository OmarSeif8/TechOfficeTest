/**
 * NextAuth v4 configuration — server-only.
 *
 * This is the central configuration object consumed by:
 *   1. The App Router catch-all handler at
 *      `src/app/api/auth/[...nextauth]/route.ts`.
 *   2. `getServerSession(authOptions)` callers via `src/lib/auth.ts`.
 *
 * Layer purity:
 *   `src/lib/**` is unrestricted by the eslint layer-purity rules — it may
 *   import `next-auth`, `bcryptjs`, `@prisma/client` (via `@/lib/db`). It
 *   must NEVER be imported from `src/components/`, `src/shared/`, or
 *   `src/domain/` — the eslint rules mechanically block those.
 *
 * Strategy: JWT (not database sessions).
 *   - Phase 1 MVP uses stateless JWTs. The `Session` Prisma table is
 *     reserved for future use (e.g., when adding a real revocation list or
 *     switching to database-strategy sessions); it is not written to here.
 *   - `maxAge: 30 days` matches the `expiresAt` returned by
 *     `NextAuthProvider.signIn` / `signUp` so service-context sessions and
 *     HTTP sessions agree on lifetime.
 *
 * Security invariants (Constitution §3 non-negotiables, mechanically enforced
 * by `authorize`):
 *   - Lookup is by lowercase email.
 *   - Soft-deleted users (`deletedAt != null`) cannot authenticate.
 *   - OAuth-only users (`passwordHash` null/empty) cannot use credentials.
 *   - Password verification uses `bcrypt.compare` (constant-time); plaintext
 *     is never logged or surfaced.
 */

import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

/**
 * 30 days in seconds — the NextAuth JWT `maxAge`. Matches the `expiresAt`
 * returned by `NextAuthProvider` so service-context sessions and HTTP
 * sessions agree on lifetime.
 */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
    maxAge: SESSION_MAX_AGE_SECONDS,
  },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        // Normalize email to lowercase for lookup. Our schema has
        // `email String @unique` (SQLite, case-sensitive collation), so the
        // `NextAuthProvider.signUp` always lowercases before writing — the
        // lookup here must lowercase too to match.
        const email = credentials.email.toLowerCase().trim();

        const user = await db.user.findUnique({ where: { email } });
        if (!user) return null;

        // Soft-deleted users cannot sign in.
        if (user.deletedAt) return null;

        // OAuth-only users (no password hash) cannot use credentials.
        if (!user.passwordHash) return null;

        const valid = await bcrypt.compare(
          credentials.password,
          user.passwordHash,
        );
        if (!valid) return null;

        // NextAuth's `User` shape — only id, email, name are surfaced to
        // the JWT callback. `passwordHash` is never put on the token.
        return {
          id: user.id,
          email: user.email,
          name: user.name ?? null,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      // `user` is only present on the initial sign-in call; subsequent
      // JWT calls receive only `token`. We persist userId / email / name on
      // the token here so the session callback can re-surface them.
      if (user) {
        token.userId = user.id;
        token.email = user.email;
        token.name = user.name ?? token.name;
      }
      return token;
    },
    async session({ session, token }) {
      // Re-surface the userId onto session.user.id so HTTP callers using
      // `getServerSession(authOptions)` can do `session.user.id` without a
      // DB roundtrip.
      if (session.user) {
        (session.user as { id?: string }).id = token.userId as string;
      }
      return session;
    },
  },
  pages: {
    // Phase 1: no actual page yet, but configured so a future WO can drop in
    // `src/app/auth/signin/page.tsx` without touching this config.
    signIn: "/auth/signin",
  },
};
