/**
 * NextAuth App Router handler.
 *
 * Mounts NextAuth under `/api/auth/*` so all of NextAuth's built-in flows
 * are reachable:
 *   - GET  /api/auth/providers    → list of configured providers
 *   - GET  /api/auth/csrf         → CSRF token for sign-in forms
 *   - POST /api/auth/signin       → credentials sign-in (issues JWT cookie)
 *   - POST /api/auth/signout      → clears the JWT cookie
 *   - GET  /api/auth/session      → current session JSON (null if signed out)
 *
 * Layer purity: top of the stack — App Router route handler. May import
 * anything below (`@/lib/*`).
 */

import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth-options";

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
