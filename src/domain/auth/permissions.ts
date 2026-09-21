/**
 * Pure Domain: Project Role-Based Access Control (RBAC) & Permissions
 *
 * Implements strict multi-tenant authorization rules for civil engineering projects.
 *
 * Law of Layers:
 *   - PURE DOMAIN: Zero imports from Next.js, React, Prisma, or Node.js.
 *   - 100% isomorphic and portable to browser, server, and desktop.
 */

export type ProjectRole =
  | "OWNER"
  | "PROJECT_MANAGER"
  | "QUANTITY_SURVEYOR"
  | "SITE_ENGINEER"
  | "CONSULTANT"
  | "SUBCONTRACTOR"
  | "VIEWER";

export type ProjectPermission =
  // Project Admin
  | "project:manage"
  | "project:view"
  | "project:delete"
  // BoQ & Rates
  | "boq:view_quantities"
  | "boq:view_rates"
  | "boq:edit_quantities"
  | "boq:edit_rates"
  | "boq:rate_analysis"
  // CPM Scheduling
  | "scheduling:view"
  | "scheduling:edit"
  | "scheduling:run_cpm"
  // Document Control
  | "doccontrol:rfi_create"
  | "doccontrol:rfi_answer"
  | "doccontrol:submittal_submit"
  | "doccontrol:submittal_review"
  | "doccontrol:drawing_upload"
  // Payments & Commercial
  | "payments:view"
  | "payments:create"
  | "payments:certify"
  // Audit Logs
  | "audit:view";

const ALL_PERMISSIONS: readonly ProjectPermission[] = [
  "project:manage",
  "project:view",
  "project:delete",
  "boq:view_quantities",
  "boq:view_rates",
  "boq:edit_quantities",
  "boq:edit_rates",
  "boq:rate_analysis",
  "scheduling:view",
  "scheduling:edit",
  "scheduling:run_cpm",
  "doccontrol:rfi_create",
  "doccontrol:rfi_answer",
  "doccontrol:submittal_submit",
  "doccontrol:submittal_review",
  "doccontrol:drawing_upload",
  "payments:view",
  "payments:create",
  "payments:certify",
  "audit:view",
] as const;

const ROLE_PERMISSIONS: Record<ProjectRole, Set<ProjectPermission>> = {
  OWNER: new Set(ALL_PERMISSIONS),

  PROJECT_MANAGER: new Set([
    "project:manage",
    "project:view",
    "boq:view_quantities",
    "boq:view_rates",
    "boq:edit_quantities",
    "boq:edit_rates",
    "boq:rate_analysis",
    "scheduling:view",
    "scheduling:edit",
    "scheduling:run_cpm",
    "doccontrol:rfi_create",
    "doccontrol:rfi_answer",
    "doccontrol:submittal_submit",
    "doccontrol:submittal_review",
    "doccontrol:drawing_upload",
    "payments:view",
    "payments:create",
    "audit:view",
  ]),

  QUANTITY_SURVEYOR: new Set([
    "project:view",
    "boq:view_quantities",
    "boq:view_rates",
    "boq:edit_quantities",
    "boq:edit_rates",
    "boq:rate_analysis",
    "scheduling:view",
    "doccontrol:rfi_create",
    "payments:view",
    "payments:create",
  ]),

  SITE_ENGINEER: new Set([
    "project:view",
    "boq:view_quantities",
    // Site engineers do NOT see commercial markup rates
    "scheduling:view",
    "doccontrol:rfi_create",
    "doccontrol:submittal_submit",
    "doccontrol:drawing_upload",
  ]),

  CONSULTANT: new Set([
    "project:view",
    "boq:view_quantities",
    // Consultant sees quantities and contract bill rates, but not contractor internal rate analysis
    "boq:view_rates",
    "scheduling:view",
    "doccontrol:rfi_create",
    "doccontrol:rfi_answer",
    "doccontrol:submittal_review",
    "payments:view",
    "payments:certify",
  ]),

  SUBCONTRACTOR: new Set([
    "project:view",
    "boq:view_quantities",
    "doccontrol:rfi_create",
    "doccontrol:submittal_submit",
  ]),

  VIEWER: new Set([
    "project:view",
    "boq:view_quantities",
    "scheduling:view",
  ]),
};

/**
 * Checks if a project role possesses a specific capability.
 */
export function hasProjectPermission(
  role: ProjectRole,
  permission: ProjectPermission
): boolean {
  const perms = ROLE_PERMISSIONS[role];
  return perms ? perms.has(permission) : false;
}

/**
 * Returns all permissions granted to a given role.
 */
export function getRolePermissions(role: ProjectRole): readonly ProjectPermission[] {
  const perms = ROLE_PERMISSIONS[role];
  return perms ? Array.from(perms) : [];
}

/**
 * Check if the role is allowed to view confidential cost rate breakdowns (markup, overhead, labor rates).
 */
export function canViewConfidentialRates(role: ProjectRole): boolean {
  return hasProjectPermission(role, "boq:rate_analysis");
}

/**
 * Check if the role is allowed to certify interim payment applications.
 */
export function canCertifyPayments(role: ProjectRole): boolean {
  return hasProjectPermission(role, "payments:certify");
}
