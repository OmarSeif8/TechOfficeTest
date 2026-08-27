# Modification Log

> **Purpose**: This file records every place where EXISTING code was changed or modified.
> It does NOT include newly created files — only modifications to files that already existed.
>
> **Started**: 2026-08-20 (after Phase 1 completion + bug scan)
>
> **Format**:
> ```
> [DATE] FILE_PATH
>   - What was changed and why
> ```

---

<!-- Entries below. Most recent at the top. -->

[2026-08-20] src/components/language-toggle.tsx
  - Fixed hydration mismatch caused by Radix UI DropdownMenu generating
    different IDs on server vs client (radix-_R_uqatmlb_ vs radix-_R_7qatmlb_).
  - Added useSyncExternalStore to detect client mount; render a placeholder
    button on server, then swap to the real DropdownMenu after hydration.
  - Pattern matches the existing theme-toggle.tsx fix.

[2026-08-20] package.json
  - Removed "2>&1 | tee dev.log" from the dev script — the pipe was causing
    the process group to be killed when the Bash command ended.
[2026-08-20] docs/planning/SPEC_PHASE3_WEB.md
  - Note: this is a NEWLY CREATED file, not a modification. But since it's a planning
    doc (not code), it doesn't count as a "modification" per the user's instructions.
    Logged here for transparency.
[2026-08-21] prisma/schema.prisma
  - Expanded Phase 4 RESERVED stubs into full model definitions:
    PaymentApplication (added periodStart, periodEnd, contractValue, retentionPercent, retentionCapAmount, advanceAmount, advanceEnabled, version, deletedAt, relations to lines/deductions/additions, unique on [projectId, ipcNo])
    Variation (renamed refNo→ref, title→titleEn, added titleAr, boqDocumentId, approvedValue, version, deletedAt, relation to Project)
    BoQItemScheduleLink (added @@unique on [boqItemId, activityId])
  - Added 11 new models: PaymentLine, PaymentDeduction, PaymentAddition, ProgressUpdate, ActivityProgress, DailyReport, DailyReportManpower, DailyReportEquipment, DailyReportWorkDone
  - Added relations from Project to PaymentApplication, Variation, ProgressUpdate, DailyReport
[2026-08-21] src/lib/stores/ui-store.ts
  - Added "subscription" to ViewName type union (Phase 5 commercial)

[2026-08-21] src/components/app-sidebar.tsx
  - Added CreditCard icon import
  - Added Subscription nav item after Settings

[2026-08-21] src/components/view-router.tsx
  - Added SubscriptionView import + case "subscription" in switch

[2026-08-21] src/i18n/messages/en.json + ar.json
  - Added nav.subscription key (EN: "Subscription", AR: "الاشتراك")
