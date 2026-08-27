/**
 * Unit tests for NextAuthProvider.
 *
 * Per task constraints:
 *   - The real DB is NEVER touched. `vi.mock("@/lib/db")` replaces the
 *     Prisma client with in-memory `vi.fn()` spies each test configures.
 *   - Real bcrypt is NEVER invoked. `vi.mock("bcryptjs")` replaces both
 *     `hash` and `compare` with `vi.fn()` spies so the suite is fast and
 *     deterministic.
 *   - `next-auth/jwt`'s `decode` is mocked so `getSession` tests don't
 *     need a real signed JWT (we assert shape, not cryptography — that's
 *     next-auth's job to test).
 *
 * The suite covers the 6 scenarios mandated by WO-W-7 plus a handful of
 * adjacent edge cases (case-insensitive email normalization, bcrypt cost
 * factor verification, signOut no-op contract, getSession secret/expiry
 * gating).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BCRYPT_COST,
  MIN_PASSWORD_LENGTH,
  NextAuthProvider,
} from "@services/auth/next-auth-provider";
import { AuthError } from "@services/auth/types";

// ---------------------------------------------------------------------------
// Mocks — all module-level mocks are hoisted by vitest before imports.
// ---------------------------------------------------------------------------

const hoisted = vi.hoisted(() => {
  const userFindUniqueMock = vi.fn();
  const userCreateMock = vi.fn();
  const userSettingsCreateMock = vi.fn();
  const bcryptHashMock = vi.fn();
  const bcryptCompareMock = vi.fn();
  const jwtDecodeMock = vi.fn();
  return {
    userFindUniqueMock,
    userCreateMock,
    userSettingsCreateMock,
    bcryptHashMock,
    bcryptCompareMock,
    jwtDecodeMock,
  };
});

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: hoisted.userFindUniqueMock,
      create: hoisted.userCreateMock,
    },
    // The provider uses a nested write (`user.create({ data: { userSettings:
    // { create: {} } } })`). Our `user.create` mock short-circuits the nested
    // write so Prisma never invokes `userSettings.create` at runtime — but we
    // expose the spy anyway so tests can assert it was NOT called (proving
    // the nested write goes through `user.create`, not as a separate call).
    userSettings: {
      create: hoisted.userSettingsCreateMock,
    },
  },
}));

vi.mock("bcryptjs", () => ({
  default: {
    hash: hoisted.bcryptHashMock,
    compare: hoisted.bcryptCompareMock,
  },
}));

vi.mock("next-auth/jwt", () => ({
  decode: hoisted.jwtDecodeMock,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_USER = {
  id: "user-1",
  email: "alice@example.com",
  name: "Alice",
  passwordHash: "hashed-password-123",
  deletedAt: null,
  emailVerified: null,
  image: null,
  role: "USER",
  locale: "EN",
  createdAt: new Date("2025-01-01T00:00:00Z"),
  updatedAt: new Date("2025-01-01T00:00:00Z"),
};

const MOCK_HASHED_PASSWORD = "mock-hashed-password-with-cost-12";

// ---------------------------------------------------------------------------
// Test lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  hoisted.userFindUniqueMock.mockReset();
  hoisted.userCreateMock.mockReset();
  hoisted.userSettingsCreateMock.mockReset();
  hoisted.bcryptHashMock.mockReset();
  hoisted.bcryptCompareMock.mockReset();
  hoisted.jwtDecodeMock.mockReset();

  // Sensible defaults so most tests don't need to rewire mocks.
  hoisted.bcryptHashMock.mockResolvedValue(MOCK_HASHED_PASSWORD);
  hoisted.bcryptCompareMock.mockResolvedValue(true);
  hoisted.jwtDecodeMock.mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// signUp
// ---------------------------------------------------------------------------

describe("NextAuthProvider.signUp", () => {
  it("creates a User with the bcrypt-hashed password, creates default UserSettings via nested write, and returns an AuthSession", async () => {
    hoisted.userCreateMock.mockResolvedValue(FIXTURE_USER);

    const provider = new NextAuthProvider();
    const session = await provider.signUp({
      email: "alice@example.com",
      password: "supersecret-123",
      name: "Alice",
    });

    // bcrypt.hash was called with the plaintext password and cost factor 12.
    expect(hoisted.bcryptHashMock).toHaveBeenCalledTimes(1);
    expect(hoisted.bcryptHashMock).toHaveBeenCalledWith(
      "supersecret-123",
      BCRYPT_COST,
    );
    expect(BCRYPT_COST).toBe(12);

    // db.user.create was called with the hashed password (NOT plaintext),
    // the lowercased email, and the nested-write shape for UserSettings.
    expect(hoisted.userCreateMock).toHaveBeenCalledTimes(1);
    const createCall = hoisted.userCreateMock.mock.calls[0][0];
    expect(createCall.data.email).toBe("alice@example.com");
    expect(createCall.data.passwordHash).toBe(MOCK_HASHED_PASSWORD);
    expect(createCall.data.passwordHash).not.toBe("supersecret-123");
    expect(createCall.data.name).toBe("Alice");
    expect(createCall.data.userSettings).toEqual({ create: {} });

    // The separate userSettings.create spy was NOT called — the nested write
    // is the responsibility of db.user.create (which Prisma handles).
    expect(hoisted.userSettingsCreateMock).not.toHaveBeenCalled();

    // The returned AuthSession mirrors the persisted User row.
    expect(session).toEqual({
      userId: "user-1",
      email: "alice@example.com",
      name: "Alice",
      expiresAt: expect.any(Date),
    });
    // expiresAt is in the future (~30 days out).
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("throws AuthError({ code: 'EMAIL_TAKEN' }) on Prisma P2002 unique-constraint violation", async () => {
    // Prisma's P2002 is the unique-constraint-violation code. The thrown
    // error has `.code === "P2002"`.
    const prismaUniqueError = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
    });
    hoisted.userCreateMock.mockRejectedValue(prismaUniqueError);

    const provider = new NextAuthProvider();
    await expect(
      provider.signUp({
        email: "alice@example.com",
        password: "supersecret-123",
      }),
    ).rejects.toMatchObject({
      name: "AuthError",
      code: "EMAIL_TAKEN",
    });

    // Verify it's specifically an AuthError instance (not a generic Error).
    try {
      await provider.signUp({
        email: "alice@example.com",
        password: "supersecret-123",
      });
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).code).toBe("EMAIL_TAKEN");
      expect((err as AuthError).cause).toBe(prismaUniqueError);
    }
  });

  it("throws AuthError({ code: 'WEAK_PASSWORD' }) when password is fewer than 8 characters", async () => {
    const provider = new NextAuthProvider();
    await expect(
      provider.signUp({
        email: "alice@example.com",
        password: "short",
      }),
    ).rejects.toMatchObject({
      name: "AuthError",
      code: "WEAK_PASSWORD",
    });

    // Verify it's an AuthError instance and the message mentions the
    // minimum length so the caller can surface it to the user.
    try {
      await provider.signUp({
        email: "alice@example.com",
        password: "7chars!",
      });
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).code).toBe("WEAK_PASSWORD");
      expect((err as Error).message).toContain(
        String(MIN_PASSWORD_LENGTH),
      );
    }

    // bcrypt.hash must NOT have been called — we rejected before hashing.
    expect(hoisted.bcryptHashMock).not.toHaveBeenCalled();
    // db.user.create must NOT have been called.
    expect(hoisted.userCreateMock).not.toHaveBeenCalled();
  });

  it("accepts an 8-character password (boundary — exactly MIN_PASSWORD_LENGTH passes)", async () => {
    hoisted.userCreateMock.mockResolvedValue(FIXTURE_USER);
    const provider = new NextAuthProvider();
    await expect(
      provider.signUp({
        email: "alice@example.com",
        password: "12345678",
      }),
    ).resolves.toBeDefined();
    expect(hoisted.bcryptHashMock).toHaveBeenCalledTimes(1);
  });

  it("normalizes email to lowercase before writing (case-insensitive unique constraint)", async () => {
    hoisted.userCreateMock.mockResolvedValue(FIXTURE_USER);
    const provider = new NextAuthProvider();
    await provider.signUp({
      email: "Alice@Example.COM",
      password: "supersecret-123",
    });
    const createCall = hoisted.userCreateMock.mock.calls[0][0];
    expect(createCall.data.email).toBe("alice@example.com");
  });

  it("writes null name when input.name is omitted", async () => {
    hoisted.userCreateMock.mockResolvedValue({
      ...FIXTURE_USER,
      name: null,
    });
    const provider = new NextAuthProvider();
    const session = await provider.signUp({
      email: "alice@example.com",
      password: "supersecret-123",
    });
    const createCall = hoisted.userCreateMock.mock.calls[0][0];
    expect(createCall.data.name).toBeNull();
    expect(session.name).toBeUndefined();
  });

  it("rethrows non-P2002 Prisma errors verbatim", async () => {
    const otherPrismaError = Object.assign(new Error("Record not found"), {
      code: "P2025",
    });
    hoisted.userCreateMock.mockRejectedValue(otherPrismaError);
    const provider = new NextAuthProvider();
    await expect(
      provider.signUp({
        email: "alice@example.com",
        password: "supersecret-123",
      }),
    ).rejects.toBe(otherPrismaError);
  });
});

// ---------------------------------------------------------------------------
// signIn
// ---------------------------------------------------------------------------

describe("NextAuthProvider.signIn", () => {
  it("returns an AuthSession on valid credentials", async () => {
    hoisted.userFindUniqueMock.mockResolvedValue(FIXTURE_USER);
    hoisted.bcryptCompareMock.mockResolvedValue(true);

    const provider = new NextAuthProvider();
    const session = await provider.signIn({
      email: "alice@example.com",
      password: "supersecret-123",
    });

    expect(session).toEqual({
      userId: "user-1",
      email: "alice@example.com",
      name: "Alice",
      expiresAt: expect.any(Date),
    });
    expect(session?.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // Lookup was by the lowercased email.
    expect(hoisted.userFindUniqueMock).toHaveBeenCalledTimes(1);
    expect(hoisted.userFindUniqueMock).toHaveBeenCalledWith({
      where: { email: "alice@example.com" },
    });

    // bcrypt.compare was called with the plaintext + stored hash.
    expect(hoisted.bcryptCompareMock).toHaveBeenCalledTimes(1);
    expect(hoisted.bcryptCompareMock).toHaveBeenCalledWith(
      "supersecret-123",
      "hashed-password-123",
    );
  });

  it("returns null on invalid password (bcrypt.compare resolves false)", async () => {
    hoisted.userFindUniqueMock.mockResolvedValue(FIXTURE_USER);
    hoisted.bcryptCompareMock.mockResolvedValue(false);

    const provider = new NextAuthProvider();
    const session = await provider.signIn({
      email: "alice@example.com",
      password: "wrong-password",
    });
    expect(session).toBeNull();
  });

  it("returns null when the user does not exist", async () => {
    hoisted.userFindUniqueMock.mockResolvedValue(null);
    const provider = new NextAuthProvider();
    const session = await provider.signIn({
      email: "nobody@example.com",
      password: "whatever",
    });
    expect(session).toBeNull();
    // bcrypt.compare must NOT be called when the user wasn't found.
    expect(hoisted.bcryptCompareMock).not.toHaveBeenCalled();
  });

  it("returns null for a soft-deleted user (User.deletedAt is set)", async () => {
    hoisted.userFindUniqueMock.mockResolvedValue({
      ...FIXTURE_USER,
      deletedAt: new Date("2025-01-02T00:00:00Z"),
    });
    const provider = new NextAuthProvider();
    const session = await provider.signIn({
      email: "alice@example.com",
      password: "supersecret-123",
    });
    expect(session).toBeNull();
    // bcrypt.compare must NOT be called — we short-circuit on soft-delete.
    expect(hoisted.bcryptCompareMock).not.toHaveBeenCalled();
  });

  it("returns null for an OAuth-only user (User.passwordHash is null)", async () => {
    hoisted.userFindUniqueMock.mockResolvedValue({
      ...FIXTURE_USER,
      passwordHash: null,
    });
    const provider = new NextAuthProvider();
    const session = await provider.signIn({
      email: "alice@example.com",
      password: "supersecret-123",
    });
    expect(session).toBeNull();
    // bcrypt.compare must NOT be called — no hash to compare against.
    expect(hoisted.bcryptCompareMock).not.toHaveBeenCalled();
  });

  it("returns null for an OAuth-only user (User.passwordHash is empty string)", async () => {
    hoisted.userFindUniqueMock.mockResolvedValue({
      ...FIXTURE_USER,
      passwordHash: "",
    });
    const provider = new NextAuthProvider();
    const session = await provider.signIn({
      email: "alice@example.com",
      password: "supersecret-123",
    });
    expect(session).toBeNull();
    expect(hoisted.bcryptCompareMock).not.toHaveBeenCalled();
  });

  it("returns null when email is missing from credentials", async () => {
    const provider = new NextAuthProvider();
    const session = await provider.signIn({
      email: "",
      password: "supersecret-123",
    });
    expect(session).toBeNull();
    expect(hoisted.userFindUniqueMock).not.toHaveBeenCalled();
  });

  it("returns null when password is missing from credentials", async () => {
    const provider = new NextAuthProvider();
    const session = await provider.signIn({
      email: "alice@example.com",
      password: "",
    });
    expect(session).toBeNull();
    expect(hoisted.userFindUniqueMock).not.toHaveBeenCalled();
  });

  it("normalizes email to lowercase before lookup (case-insensitive)", async () => {
    hoisted.userFindUniqueMock.mockResolvedValue(FIXTURE_USER);
    const provider = new NextAuthProvider();
    await provider.signIn({
      email: "Alice@Example.COM",
      password: "supersecret-123",
    });
    expect(hoisted.userFindUniqueMock).toHaveBeenCalledWith({
      where: { email: "alice@example.com" },
    });
  });
});

// ---------------------------------------------------------------------------
// signOut
// ---------------------------------------------------------------------------

describe("NextAuthProvider.signOut", () => {
  it("is a no-op in JWT mode (returns void, does not touch the DB)", async () => {
    const provider = new NextAuthProvider();
    const result = await provider.signOut("some-jwt-token");
    expect(result).toBeUndefined();
    // No DB calls should be made.
    expect(hoisted.userFindUniqueMock).not.toHaveBeenCalled();
    expect(hoisted.userCreateMock).not.toHaveBeenCalled();
    expect(hoisted.userSettingsCreateMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getSession
// ---------------------------------------------------------------------------

describe("NextAuthProvider.getSession", () => {
  beforeEach(() => {
    // Set NEXTAUTH_SECRET for getSession tests.
    process.env.NEXTAUTH_SECRET = "test-secret-for-decode-1234567890";
  });

  it("returns null when NEXTAUTH_SECRET is not configured", async () => {
    delete process.env.NEXTAUTH_SECRET;
    const provider = new NextAuthProvider();
    const session = await provider.getSession("some-jwt-token");
    expect(session).toBeNull();
    // decode must NOT be called when secret is missing.
    expect(hoisted.jwtDecodeMock).not.toHaveBeenCalled();
  });

  it("returns null when the token is an empty string", async () => {
    const provider = new NextAuthProvider();
    const session = await provider.getSession("");
    expect(session).toBeNull();
    expect(hoisted.jwtDecodeMock).not.toHaveBeenCalled();
  });

  it("returns null when decode returns null (malformed / unverifiable JWT)", async () => {
    hoisted.jwtDecodeMock.mockResolvedValue(null);
    const provider = new NextAuthProvider();
    const session = await provider.getSession("garbage-token-string");
    expect(session).toBeNull();
  });

  it("returns null when decode throws (malformed JWT format)", async () => {
    hoisted.jwtDecodeMock.mockRejectedValue(new Error("invalid jwt"));
    const provider = new NextAuthProvider();
    const session = await provider.getSession("garbage-token-string");
    expect(session).toBeNull();
  });

  it("returns an AuthSession when decode returns a valid JWT with userId + email", async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 60 * 60; // 1 hour from now
    hoisted.jwtDecodeMock.mockResolvedValue({
      userId: "user-1",
      email: "alice@example.com",
      name: "Alice",
      exp: futureExp,
    });
    const provider = new NextAuthProvider();
    const session = await provider.getSession("valid-jwt-token");
    expect(session).toEqual({
      userId: "user-1",
      email: "alice@example.com",
      name: "Alice",
      expiresAt: new Date(futureExp * 1000),
    });
  });

  it("returns null when decoded token has no userId", async () => {
    hoisted.jwtDecodeMock.mockResolvedValue({
      email: "alice@example.com",
      name: "Alice",
    });
    const provider = new NextAuthProvider();
    const session = await provider.getSession("jwt-without-userid");
    expect(session).toBeNull();
  });

  it("returns null when decoded token has no email", async () => {
    hoisted.jwtDecodeMock.mockResolvedValue({
      userId: "user-1",
      name: "Alice",
    });
    const provider = new NextAuthProvider();
    const session = await provider.getSession("jwt-without-email");
    expect(session).toBeNull();
  });

  it("returns null when the decoded JWT has expired (exp in the past)", async () => {
    const pastExp = Math.floor(Date.now() / 1000) - 60; // 1 minute ago
    hoisted.jwtDecodeMock.mockResolvedValue({
      userId: "user-1",
      email: "alice@example.com",
      name: "Alice",
      exp: pastExp,
    });
    const provider = new NextAuthProvider();
    const session = await provider.getSession("expired-jwt-token");
    expect(session).toBeNull();
  });
});
