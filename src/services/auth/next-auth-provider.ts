/**
 * NextAuthProvider — `IAuthProvider` implementation backed by Prisma + bcrypt.
 *
 * This is the NON-HTTP consumer of the auth surface (PLATFORM_PORTABILITY
 * §4.1): scripts, the future Electron main process, CLI tools. HTTP flows
 * go straight through NextAuth (`getServerSession(authOptions)` in
 * `@/lib/auth.ts`) — they do NOT call into this class.
 *
 * Layer purity:
 *   `src/services/**` is unrestricted by eslint — may import `@/lib/db`,
 *   `bcryptjs`, `next-auth`, etc. It must NOT import `react`.
 *
 * Strategy: JWT (stateless). The implementation mirrors the verification logic
 * in `src/lib/auth-options.ts` `authorize` callback (intentional duplication —
 * the two are separate concerns: `authorize` returns the NextAuth `User`
 * shape `{ id, email, name }` to NextAuth's flow; `signIn` here returns the
 * portable `AuthSession` shape to direct callers).
 *
 * Constitution §3 non-negotiables enforced structurally:
 *   - Plaintext passwords are NEVER stored — `signUp` always bcrypt-hashes
 *     at cost factor 12 before writing to `User.passwordHash`.
 *   - Soft-deleted users cannot authenticate (`User.deletedAt != null`
 *     short-circuits `signIn` to `null`).
 *   - OAuth-only users (no `passwordHash`) cannot use credentials.
 *   - Email lookup is case-insensitive — `signUp` lowercases before
 *     writing, `signIn` lowercases before querying.
 */

import bcrypt from "bcryptjs";
import { decode, type JWT } from "next-auth/jwt";
import { db } from "@/lib/db";
import {
  AuthError,
  type AuthSession,
  type AuthSignupInput,
  type IAuthProvider,
  type AuthCredentials,
} from "@/services/auth/types";

/**
 * bcrypt cost factor — Constitution §3 mandates industry-standard password
 * hashing. Cost 12 is the OWASP-recommended floor for bcrypt in 2025
 * (~250ms per hash on commodity hardware).
 */
export const BCRYPT_COST = 12;

/**
 * Minimum password length enforced by `signUp`. Below this threshold throws
 * `AuthError({ code: "WEAK_PASSWORD" })`.
 */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Session lifetime in milliseconds — matches `authOptions.session.maxAge`
 * (`SESSION_MAX_AGE_SECONDS` in `@/lib/auth-options.ts`) so service-context
 * sessions and HTTP JWT sessions agree on lifetime.
 */
export const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Prisma error code for unique-constraint violation. Used to translate the
 * raw `User.email` duplicate into `AuthError({ code: "EMAIL_TAKEN" })`.
 */
const PRISMA_UNIQUE_CONSTRAINT_VIOLATION = "P2002";

/**
 * Normalize an email for storage / lookup. Our schema has
 * `email String @unique` (SQLite, case-sensitive collation), so we always
 * lowercase + trim on both write and read to make the unique constraint
 * case-insensitive at the application layer.
 */
function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

/**
 * Build an `AuthSession` from the persisted `User` row. Does NOT include
 * `passwordHash` — that field never leaves the data layer.
 */
function toAuthSession(user: {
  id: string;
  email: string;
  name: string | null;
}): AuthSession {
  return {
    userId: user.id,
    email: user.email,
    name: user.name ?? undefined,
    expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS),
  };
}

export class NextAuthProvider implements IAuthProvider {
  async signIn(credentials: AuthCredentials): Promise<AuthSession | null> {
    if (!credentials?.email || !credentials?.password) return null;

    const email = normalizeEmail(credentials.email);

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

    return toAuthSession(user);
  }

  async signUp(input: AuthSignupInput): Promise<AuthSession> {
    // Password strength — checked before any DB or bcrypt work so we don't
    // spend cycles hashing a password we'll reject.
    if (
      typeof input.password !== "string" ||
      input.password.length < MIN_PASSWORD_LENGTH
    ) {
      throw new AuthError({
        message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`,
        code: "WEAK_PASSWORD",
      });
    }

    const email = normalizeEmail(input.email);
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);

    // Create User + UserSettings atomically. If the email is already taken,
    // Prisma throws P2002 on `user.create` — we translate that to
    // `AuthError({ code: "EMAIL_TAKEN" })`.
    try {
      const user = await db.user.create({
        data: {
          email,
          passwordHash,
          name: input.name ?? null,
          // UserSettings is created as a nested write so the two inserts are
          // atomic. Defaults come from the Prisma schema
          // (theme=DARK, locale=EN, defaultLaborMode=CONSUMPTION,
          // defaultOverheadPct="10", defaultProfitPct="15",
          // autosaveIntervalMs=2000).
          userSettings: {
            create: {},
          },
        },
      });

      return toAuthSession(user);
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code?: unknown }).code ===
          PRISMA_UNIQUE_CONSTRAINT_VIOLATION
      ) {
        throw new AuthError({
          message: `An account with email "${email}" already exists.`,
          code: "EMAIL_TAKEN",
          cause: err,
        });
      }
      throw err;
    }
  }

  /**
   * No-op in JWT mode — JWTs are stateless. The caller must discard the
   * token; revocation lists are a Phase 5+ concern (the `Session` Prisma
   * table is reserved for that).
   */
  async signOut(_sessionToken: string): Promise<void> {
    // Intentionally empty. The parameter name is prefixed with `_` to
    // satisfy linters that flag unused params; the interface still
    // accepts it so the future Electron impl can wire a real session-table
    // delete here without changing the call site.
    void _sessionToken;
    return;
  }

  async getSession(sessionToken: string): Promise<AuthSession | null> {
    if (
      typeof sessionToken !== "string" ||
      sessionToken.length === 0
    ) {
      return null;
    }

    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) {
      // No secret configured → cannot verify JWTs. Treat as "no session".
      return null;
    }

    let token: JWT | null;
    try {
      token = await decode({ token: sessionToken, secret });
    } catch {
      // Malformed token (e.g., garbage string) → no session.
      return null;
    }

    if (!token) return null;

    const userId = token.userId as string | undefined;
    const email = token.email as string | undefined;
    if (!userId || !email) return null;

    // Compute expiry from the JWT `exp` claim (seconds since epoch). If
    // missing, fall back to a 30-day lifetime from now (defensive — the
    // jwt callback in auth-options doesn't set `exp` manually; NextAuth
    // adds it based on `session.maxAge`).
    const expSeconds =
      typeof token.exp === "number" ? token.exp : undefined;
    const expiresAt = expSeconds
      ? new Date(expSeconds * 1000)
      : new Date(Date.now() + SESSION_LIFETIME_MS);

    // If the JWT has already expired, treat as "no session".
    if (expiresAt.getTime() < Date.now()) {
      return null;
    }

    return {
      userId,
      email,
      name: (token.name as string | undefined) ?? undefined,
      expiresAt,
    };
  }
}
