/**
 * IAuthProvider — Authentication service abstraction (PLATFORM_PORTABILITY.md §3.3).
 *
 * Layer purity:
 *   This is an INTERFACE FILE. Per the eslint layer-purity rules in
 *   eslint.config.mjs, the `src/services/**` glob has no restricted-imports
 *   pattern attached — but this file deliberately imports nothing
 *   platform-specific so the interface itself stays portable across Next.js,
 *   Electron, Tauri, and React Native. Only stdlib types belong here.
 *
 * Two consumers in Phase 1 web:
 *   1. Next.js API routes — these go straight through NextAuth
 *      (`getServerSession(authOptions)`); they do NOT call this interface.
 *   2. Non-HTTP contexts (scripts, Electron main process in Phase 5) — these
 *      use the `IAuthProvider` implementation (`NextAuthProvider`) directly so
 *      they can sign users in / sign them up without an HTTP roundtrip.
 *
 * Constitution §3 non-negotiables enforced structurally:
 *   - Passwords are NEVER stored as plaintext — the implementation must hash
 *     with bcrypt at cost factor 12. The interface accepts plaintext only on
 *     `signUp` / `signIn` inputs, never in `AuthSession` outputs.
 *   - Soft-deleted users cannot authenticate (`User.deletedAt` is checked
 *     inside the implementation — surfaced here as a `null` return from
 *     `signIn`, not an error, so attackers cannot distinguish "user does not
 *     exist" from "user is deleted" from "wrong password").
 */

// ---------------------------------------------------------------------------
// Session / input shapes
// ---------------------------------------------------------------------------

export interface AuthSession {
  userId: string;
  email: string;
  name?: string;
  /** When the session expires — in JWT mode this mirrors the JWT `exp` claim. */
  expiresAt: Date;
}

export interface AuthCredentials {
  email: string;
  password: string;
}

export interface AuthSignupInput {
  email: string;
  password: string;
  name?: string;
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface IAuthProvider {
  /**
   * Verify credentials and return an `AuthSession` on success, or `null` on
   * any failure (user not found, wrong password, soft-deleted, OAuth-only
   * user with no password hash). Callers cannot distinguish between failure
   * modes from the return value — this is intentional to avoid user
   * enumeration.
   *
   * In JWT mode, this does NOT issue a JWT — that's NextAuth's job when the
   * caller is an HTTP flow. Non-HTTP callers (scripts, Electron) typically
   * don't need a JWT at all; they just keep the returned `AuthSession` in
   * memory.
   */
  signIn(credentials: AuthCredentials): Promise<AuthSession | null>;

  /**
   * Create a new user with a hashed password and default `UserSettings`,
   * then return an `AuthSession`. Throws `AuthError`:
   *   - `EMAIL_TAKEN` if the email is already registered
   *   - `WEAK_PASSWORD` if the password is fewer than 8 characters
   */
  signUp(input: AuthSignupInput): Promise<AuthSession>;

  /**
   * Invalidate a session. In JWT mode this is a no-op (JWTs are stateless —
   * the caller must discard the token; revocation lists are a Phase 5+
   * concern). Kept on the interface so the future Electron impl can wire a
   * real session-table delete without changing call sites.
   */
  signOut(sessionToken: string): Promise<void>;

  /**
   * Verify a session token and return its `AuthSession`, or `null` if the
   * token is invalid / expired / malformed. In JWT mode this decodes the
   * NextAuth-issued JWT using `NEXTAUTH_SECRET`.
   */
  getSession(sessionToken: string): Promise<AuthSession | null>;

  // Future Electron (Phase 5+): validateLicenseFile / machine binding
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type AuthErrorCode =
  | "INVALID_CREDENTIALS" // email/password mismatch (informational only — signIn returns null by design)
  | "EMAIL_TAKEN" // signUp hit a pre-existing user with the same email
  | "EXPIRED_SESSION" // getSession decoded a token whose exp has passed
  | "WEAK_PASSWORD"; // signUp rejected a password below the minimum strength

export interface AuthErrorInit {
  message: string;
  code: AuthErrorCode;
  cause?: unknown;
}

/**
 * Typed error wrapper for all auth provider failures.
 *
 * `signIn` returns `null` (not an `AuthError`) on credential mismatch by
 * design — see the interface docstring. `AuthError` is reserved for
 * deterministic, actionable failures the caller must handle: `EMAIL_TAKEN`
 * (suggest login flow), `WEAK_PASSWORD` (suggest password reset flow),
 * `EXPIRED_SESSION` (suggest re-auth).
 */
export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly cause?: unknown;

  constructor(init: AuthErrorInit) {
    super(init.message);
    this.name = "AuthError";
    this.code = init.code;
    this.cause = init.cause;
    // Restore prototype chain after the super() call — required when
    // subclassing Error under strict ES5/ES2017 targets so that
    // `instanceof AuthError` works after transpilation.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
