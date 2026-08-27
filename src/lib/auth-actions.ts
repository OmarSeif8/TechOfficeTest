"use client";

/**
 * Client-side auth actions — thin wrappers around the auth API.
 *
 * These call the NextAuth credentials endpoint (sign-in) or the sign-up
 * API route, then the page reloads to establish the session cookie.
 */

export interface SignUpInput {
  email: string;
  password: string;
  name?: string;
}

export interface SignInInput {
  email: string;
  password: string;
}

/**
 * Sign in via NextAuth credentials provider.
 * Calls the NextAuth /api/auth/callback/credentials endpoint with CSRF.
 */
export async function signIn(input: SignInInput): Promise<void> {
  // 1. Get CSRF token
  const csrfResp = await fetch("/api/auth/csrf");
  if (!csrfResp.ok) throw new Error("Failed to get CSRF token");
  const { csrfToken } = await csrfResp.json();

  // 2. Submit credentials to NextAuth callback
  const body = new URLSearchParams({
    email: input.email,
    password: input.password,
    csrfToken,
    json: "true",
  });

  const resp = await fetch("/api/auth/callback/credentials", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: "Sign-in failed" }));
    throw new Error(err.error || "Invalid email or password");
  }
}

/**
 * Sign up via the /api/auth/signup API route.
 * Creates the user, then signs them in.
 */
export async function signUp(input: SignUpInput): Promise<void> {
  const resp = await fetch("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: "Sign-up failed" }));
    throw new Error(err.error || "Sign-up failed");
  }

  // Now sign in with the credentials
  await signIn({ email: input.email, password: input.password });
}
