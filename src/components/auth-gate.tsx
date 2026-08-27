import { AuthView } from "@/components/views/auth-view";

/**
 * AuthGate — server component that renders the AuthView when the user
 * is not authenticated.
 *
 * This is rendered by page.tsx when DEMO_MODE=false and no session exists.
 * The AuthView (client component) handles sign-in / sign-up forms.
 */
export function AuthGate() {
  return <AuthView />;
}
