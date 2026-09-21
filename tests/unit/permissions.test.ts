import { describe, it, expect } from "vitest";
import {
  hasProjectPermission,
  getRolePermissions,
  canViewConfidentialRates,
  canCertifyPayments,
  ProjectRole,
} from "@/domain/auth/permissions";

describe("Domain Auth: Role-Based Access Control (RBAC)", () => {
  it("OWNER has all project permissions", () => {
    expect(hasProjectPermission("OWNER", "project:manage")).toBe(true);
    expect(hasProjectPermission("OWNER", "project:delete")).toBe(true);
    expect(hasProjectPermission("OWNER", "boq:rate_analysis")).toBe(true);
    expect(hasProjectPermission("OWNER", "payments:certify")).toBe(true);
  });

  it("QUANTITY_SURVEYOR can edit BoQ and view rate analysis but cannot delete project", () => {
    expect(hasProjectPermission("QUANTITY_SURVEYOR", "boq:edit_quantities")).toBe(true);
    expect(hasProjectPermission("QUANTITY_SURVEYOR", "boq:rate_analysis")).toBe(true);
    expect(hasProjectPermission("QUANTITY_SURVEYOR", "project:delete")).toBe(false);
  });

  it("SITE_ENGINEER cannot view confidential rate build-ups", () => {
    expect(hasProjectPermission("SITE_ENGINEER", "boq:view_quantities")).toBe(true);
    expect(hasProjectPermission("SITE_ENGINEER", "boq:view_rates")).toBe(false);
    expect(canViewConfidentialRates("SITE_ENGINEER")).toBe(false);
  });

  it("CONSULTANT can certify payments and review submittals but cannot view internal rate build-ups", () => {
    expect(canCertifyPayments("CONSULTANT")).toBe(true);
    expect(hasProjectPermission("CONSULTANT", "doccontrol:submittal_review")).toBe(true);
    expect(canViewConfidentialRates("CONSULTANT")).toBe(false);
  });

  it("SUBCONTRACTOR has strictly scoped access", () => {
    expect(hasProjectPermission("SUBCONTRACTOR", "boq:view_quantities")).toBe(true);
    expect(hasProjectPermission("SUBCONTRACTOR", "boq:edit_rates")).toBe(false);
    expect(hasProjectPermission("SUBCONTRACTOR", "scheduling:run_cpm")).toBe(false);
  });

  it("getRolePermissions returns non-empty list of unique permissions", () => {
    const roles: ProjectRole[] = [
      "OWNER",
      "PROJECT_MANAGER",
      "QUANTITY_SURVEYOR",
      "SITE_ENGINEER",
      "CONSULTANT",
      "SUBCONTRACTOR",
      "VIEWER",
    ];

    for (const role of roles) {
      const perms = getRolePermissions(role);
      expect(perms.length).toBeGreaterThan(0);
      const unique = new Set(perms);
      expect(unique.size).toBe(perms.length);
    }
  });
});
