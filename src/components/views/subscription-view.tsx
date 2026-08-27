"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Check, Crown, Zap, Building2, Clock, AlertCircle } from "lucide-react";
import { apiPost } from "@/lib/mutations";
import { fetchJson } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

/**
 * SubscriptionView — Phase 5 commercial hardening.
 *
 * Shows the user's current subscription status + plan comparison + upgrade.
 * Per SPEC 5: two-tier pricing (Standard = BoQ+Documents, Pro = everything).
 *
 * Web adaptation: no Ed25519 license file (desktop-only). Uses DB Subscription
 * row. The trial starts automatically on sign-up (30 days, PRO plan).
 */

interface LicenseStatus {
  status: "trial" | "active" | "expired" | "canceled" | "free";
  plan: "FREE" | "PRO" | "ENTERPRISE";
  canEdit: boolean;
  canView: boolean;
  daysRemaining: number | null;
  trialEndsAt: string | null;
  message: string;
}

const PLANS = [
  {
    id: "FREE" as const,
    name: "Standard",
    icon: Building2,
    price: "Free",
    description: "BoQ + Document Control",
    features: [
      "Bill of Quantities builder",
      "Rate analysis + takeoff calculators",
      "Drawing register + submittals + RFIs",
      "Excel/PDF export (EN/AR)",
      "DXF viewer (read-only)",
      "1 project",
    ],
    notIncluded: [
      "CPM scheduling + Gantt",
      "Payments (IPC engine)",
      "Cost-schedule integration (S-curves)",
      "Earned value (SPI)",
      "Daily + monthly reports",
    ],
  },
  {
    id: "PRO" as const,
    name: "Pro",
    icon: Crown,
    price: "$49/mo",
    description: "Everything — the differentiator",
    features: [
      "Everything in Standard, plus:",
      "CPM scheduling + Gantt chart",
      "Payments (IPC engine)",
      "Cost-schedule integration (BoQ↔schedule↔cash flow)",
      "Earned value + SPI + S-curves",
      "Daily + monthly reports",
      "Unlimited projects",
      "AI natural-language queries",
      "Priority support",
    ],
    notIncluded: [],
  },
];

export function SubscriptionView() {
  const t = useTranslations();
  const queryClient = useQueryClient();

  const { data: license, isLoading } = useQuery<LicenseStatus>({
    queryKey: ["license", "status"],
    queryFn: () => fetchJson("/api/license"),
  });

  const startTrialMutation = useMutation({
    mutationFn: () => apiPost("/api/license/start-trial", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["license"] });
      toast.success("Trial started — 30 days of full Pro access");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto p-8">
        <h1 className="text-2xl font-semibold tracking-tight mb-8">Subscription</h1>
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }

  const currentPlan = license?.plan ?? "FREE";
  const isTrial = license?.status === "trial";
  const isExpired = license?.status === "expired" || license?.status === "canceled";

  return (
    <div className="max-w-4xl mx-auto p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Subscription</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your TechOffice plan
        </p>
      </div>

      {/* Current status card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Current Plan
            <Badge variant={currentPlan === "FREE" ? "outline" : "default"}>
              {currentPlan}
            </Badge>
          </CardTitle>
          <CardDescription>{license?.message ?? "Loading..."}</CardDescription>
        </CardHeader>
        <CardContent>
          {isTrial && (
            <div className="flex items-center gap-2 text-sm">
              <Clock className="w-4 h-4 text-[var(--linear-warning)]" />
              <span className="text-[var(--linear-warning)]">
                Trial: {license?.daysRemaining} days remaining
              </span>
              {license?.trialEndsAt && (
                <span className="text-muted-foreground">
                  (ends {new Date(license.trialEndsAt).toLocaleDateString()})
                </span>
              )}
            </div>
          )}
          {isExpired && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="w-4 h-4" />
              <span>
                {license?.status === "expired"
                  ? "Your subscription has expired. You can still view and export your data."
                  : "Your subscription was canceled. You can still view and export your data."}
              </span>
            </div>
          )}
          {license?.status === "free" && (
            <div className="flex items-center gap-3">
              <p className="text-sm text-muted-foreground">
                You're on the free plan. Start a 30-day trial for full Pro access.
              </p>
              <Button
                size="sm"
                onClick={() => startTrialMutation.mutate()}
                disabled={startTrialMutation.isPending}
              >
                Start free trial
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Plan comparison */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {PLANS.map((plan) => {
          const Icon = plan.icon;
          const isCurrent = currentPlan === plan.id;
          const isUpgrade = plan.id === "PRO" && currentPlan !== "PRO";

          return (
            <Card
              key={plan.id}
              className={isCurrent ? "border-primary" : ""}
            >
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className="w-5 h-5 text-primary" />
                    <CardTitle>{plan.name}</CardTitle>
                  </div>
                  {isCurrent && <Badge>Current</Badge>}
                </div>
                <CardDescription>
                  <span className="text-lg font-semibold text-foreground">{plan.price}</span>
                  {" — "}
                  {plan.description}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <ul className="space-y-1.5 text-sm">
                  {plan.features.map((f, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-[var(--linear-success)] mt-0.5 shrink-0" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                {plan.notIncluded.length > 0 && (
                  <ul className="space-y-1.5 text-sm text-muted-foreground">
                    {plan.notIncluded.map((f, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-muted-foreground/40 mt-0.5">—</span>
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {isUpgrade && (
                  <Button
                    className="w-full mt-4"
                    variant="default"
                    disabled
                  >
                    Upgrade (coming soon)
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Data safety note */}
      <div className="rounded-lg border border-border p-4 bg-card">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-muted-foreground mt-0.5" />
          <div>
            <h3 className="text-sm font-medium">Your data is always yours</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Even if your subscription expires, you can always view and export your
              data. TechOffice never holds your data hostage — export to Excel or PDF
              at any time, in English or Arabic.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
