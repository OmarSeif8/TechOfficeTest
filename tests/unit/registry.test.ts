/**
 * Registry + services wiring tests.
 *
 * Verifies:
 *   - getContainer() returns a singleton with all services wired
 *   - All repositories (Group D) are available without throwing
 *   - AI + Auth providers are wired correctly
 *   - _resetContainerForTesting() isolates state between tests
 *   - registerRepositories() allows overriding for test injection
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  getContainer,
  registerRepositories,
  _resetContainerForTesting,
} from "@/infrastructure/registry";
import { getServices } from "@/lib/services";

// Reset the singleton before each test so they don't pollute each other
beforeEach(() => {
  _resetContainerForTesting();
});

describe("Provider Registry (WO-W-8 + Group D wiring)", () => {
  it("getContainer returns a singleton", () => {
    const c1 = getContainer();
    const c2 = getContainer();
    expect(c1).toBe(c2); // same instance
  });

  it("AI provider is wired (ZaiAiProvider)", () => {
    const c = getContainer();
    expect(c.ai).toBeDefined();
    expect(c.ai.name).toBe("zai");
  });

  it("Auth provider is wired (NextAuthProvider)", () => {
    const c = getContainer();
    expect(c.auth).toBeDefined();
  });

  it("Prisma client is wired", () => {
    const c = getContainer();
    expect(c.prisma).toBeDefined();
    expect(typeof c.prisma.$connect).toBe("function");
  });

  it("Project repository is wired (PrismaProjectRepository)", () => {
    const c = getContainer();
    expect(c.projects).toBeDefined();
    expect(typeof c.projects.list).toBe("function");
    expect(typeof c.projects.getById).toBe("function");
    expect(typeof c.projects.create).toBe("function");
  });

  it("BoQ repository is wired (PrismaBoQRepository)", () => {
    const c = getContainer();
    expect(c.boq).toBeDefined();
    expect(typeof c.boq.listDocuments).toBe("function");
    expect(typeof c.boq.createItem).toBe("function");
  });

  it("Library repository is wired (PrismaItemLibraryRepository)", () => {
    const c = getContainer();
    expect(c.library).toBeDefined();
    expect(typeof c.library.search).toBe("function");
    expect(typeof c.library.listCategories).toBe("function");
  });

  it("Calculation repository is wired (PrismaCalculationRepository)", () => {
    const c = getContainer();
    expect(c.calculation).toBeDefined();
    expect(typeof c.calculation.listByProject).toBe("function");
    expect(typeof c.calculation.linkToBoqItem).toBe("function");
  });

  it("RateAnalysis repository is wired (PrismaRateAnalysisRepository)", () => {
    const c = getContainer();
    expect(c.rateAnalysis).toBeDefined();
    expect(typeof c.rateAnalysis.create).toBe("function");
    expect(typeof c.rateAnalysis.applyToBoqItem).toBe("function");
  });

  it("getServices() returns all services (no lazy throws anymore)", () => {
    const services = getServices();
    expect(services.ai).toBeDefined();
    expect(services.ai.name).toBe("zai");
    expect(services.auth).toBeDefined();
    expect(services.prisma).toBeDefined();
    expect(services.projects).toBeDefined();
    expect(services.boq).toBeDefined();
    expect(services.library).toBeDefined();
    expect(services.calculation).toBeDefined();
    expect(services.rateAnalysis).toBeDefined();
  });

  it("registerRepositories allows overriding for test injection", () => {
    const fakeProjects = {
      list: async () => [],
      count: async () => 0,
      getById: async () => null,
      create: async () => ({}),
      update: async () => ({ kind: "not_found" as const }),
      softDelete: async () => ({ kind: "not_found" as const }),
      restore: async () => null,
    };
    registerRepositories({ projects: fakeProjects as never });

    const c = getContainer();
    expect(c.projects).toBe(fakeProjects);
    // Other repos remain wired
    expect(c.boq).toBeDefined();
  });

  it("_resetContainerForTesting creates a fresh instance", () => {
    const c1 = getContainer();
    _resetContainerForTesting();
    const c2 = getContainer();
    expect(c1).not.toBe(c2);
  });

  it("All services are real instances (not undefined)", () => {
    const services = getServices();
    // All of these should be defined — no more lazy throws
    expect(() => services.projects).not.toThrow();
    expect(() => services.boq).not.toThrow();
    expect(() => services.library).not.toThrow();
    expect(() => services.calculation).not.toThrow();
    expect(() => services.rateAnalysis).not.toThrow();
    expect(() => services.ai).not.toThrow();
    expect(() => services.auth).not.toThrow();
  });
});
