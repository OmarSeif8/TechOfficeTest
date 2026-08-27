"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { signIn, signUp } from "@/lib/auth-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Loader2, Mail, Lock, User as UserIcon } from "lucide-react";
import { toast } from "sonner";

/**
 * AuthView — sign-in / sign-up screen.
 *
 * Replaces the demo mode hack with proper authentication UI. Shows when
 * the user is not authenticated. On successful sign-in, the page reloads
 * to establish the session cookie, then the dashboard shows.
 *
 * Per CONSTITUTION_V1.1_WEB §3: "AI proposes, engineer approves" —
 * auth is required for all mutations (BR-WEB-5).
 *
 * Phase 1: email + password credentials. OAuth (Google, GitHub) deferred
 * to Phase 5 per ERD v1.1.
 */
export function AuthView() {
  const t = useTranslations("auth");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [loading, setLoading] = useState(false);

  // Form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      if (mode === "signup") {
        if (password !== confirmPassword) {
          toast.error("Passwords do not match");
          setLoading(false);
          return;
        }
        if (password.length < 8) {
          toast.error("Password must be at least 8 characters");
          setLoading(false);
          return;
        }
        await signUp({ email, password, name: name || undefined });
        toast.success("Account created — signing you in...");
      } else {
        await signIn({ email, password });
        toast.success("Signed in");
      }
      // Reload to establish session cookie + load dashboard
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-8 h-8 rounded bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-sm">T</span>
          </div>
          <span className="font-semibold text-lg tracking-tight">TechOffice</span>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">
              {mode === "signin" ? t("signIn") : t("signUp")}
            </CardTitle>
            <CardDescription>
              {mode === "signin"
                ? "Sign in to your engineering technical office"
                : "Create an account to start building BoQs"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === "signup" && (
                <div className="space-y-2">
                  <Label htmlFor="name">{t("name")}</Label>
                  <div className="relative">
                    <UserIcon className="absolute left-2 top-2.5 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="pl-8"
                      placeholder="Your name"
                      disabled={loading}
                    />
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="email">{t("email")}</Label>
                <div className="relative">
                  <Mail className="absolute left-2 top-2.5 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-8"
                    placeholder="engineer@firm.com"
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">{t("password")}</Label>
                <div className="relative">
                  <Lock className="absolute left-2 top-2.5 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-8"
                    placeholder="••••••••"
                    disabled={loading}
                  />
                </div>
              </div>

              {mode === "signup" && (
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">{t("confirmPassword")}</Label>
                  <div className="relative">
                    <Lock className="absolute left-2 top-2.5 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="confirmPassword"
                      type="password"
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="pl-8"
                      placeholder="••••••••"
                      disabled={loading}
                    />
                  </div>
                </div>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={loading}
              >
                {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {mode === "signin" ? t("signIn") : t("signUp")}
              </Button>
            </form>

            <div className="mt-4 text-center text-sm text-muted-foreground">
              {mode === "signin" ? (
                <>
                  {t("noAccount")}{" "}
                  <button
                    type="button"
                    onClick={() => setMode("signup")}
                    className="text-primary hover:underline"
                  >
                    {t("signUp")}
                  </button>
                </>
              ) : (
                <>
                  {t("alreadyHaveAccount")}{" "}
                  <button
                    type="button"
                    onClick={() => setMode("signin")}
                    className="text-primary hover:underline"
                  >
                    {t("signIn")}
                  </button>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-4">
          TechOffice · Phase 1 · Linear design language
        </p>
      </div>
    </div>
  );
}
