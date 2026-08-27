/**
 * Unit tests for ZaiAiProvider.
 *
 * Per task constraints: the real ZAI API is NEVER called by this suite.
 * `vi.mock("z-ai-web-dev-sdk")` replaces the SDK with an in-memory stub
 * whose `chat.completions.create` is a `vi.fn()` each test configures.
 *
 * The suite covers the 6 scenarios mandated by WO-W-6 plus a handful of
 * adjacent edge cases (UNAVAILABLE on missing env, EMPTY_RESPONSE on
 * missing content, model fallback chain, optional field forwarding).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZaiAiProvider } from "@services/ai/zai-provider";
import { AiProviderError } from "@services/ai/types";

// ---------------------------------------------------------------------------
// Mock the z-ai-web-dev-sdk module
// ---------------------------------------------------------------------------
//
// vi.mock is hoisted by vitest, so the factory runs before any of our
// imports resolve. Variables referenced inside the factory must be created
// via vi.hoisted() so they exist at hoist time. We export two spies from
// the hoisted block:
//   - chatCompletionsCreateMock: the per-call return / rejection spy.
//   - createMock: the ZAI.create() factory spy. Defaults to resolving the
//     shared mock instance. Tests may override it to simulate init failure.
const hoisted = vi.hoisted(() => {
  const chatCompletionsCreateMock = vi.fn();
  const mockInstance = {
    chat: { completions: { create: chatCompletionsCreateMock } },
  };
  const createMock = vi.fn().mockResolvedValue(mockInstance);
  return { chatCompletionsCreateMock, createMock, mockInstance };
});

vi.mock("z-ai-web-dev-sdk", () => ({
  default: class MockZAI {
    static create() {
      return hoisted.createMock();
    }
    // Instance shape — present in case the SDK is ever `new`-ed directly.
    chat = hoisted.mockInstance.chat;
  },
}));

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const FIXED_RESPONSE = {
  model: "glm-4-plus",
  choices: [
    {
      message: { role: "assistant", content: "Hello, world!" },
      finish_reason: "stop",
    },
  ],
  usage: {
    prompt_tokens: 10,
    completion_tokens: 5,
    total_tokens: 15,
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ZaiAiProvider", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    hoisted.createMock.mockReset();
    hoisted.createMock.mockResolvedValue(hoisted.mockInstance);
    hoisted.chatCompletionsCreateMock.mockReset();
    // Restore env between tests so isAvailable() gating is deterministic.
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  // ─── Test 6: name ──────────────────────────────────────────────────────
  describe("name", () => {
    it("returns 'zai'", () => {
      const provider = new ZaiAiProvider();
      expect(provider.name).toBe("zai");
    });
  });

  // ─── Tests 1 & 2: isAvailable ──────────────────────────────────────────
  describe("isAvailable", () => {
    it("returns true when process.env.ZAI_API_KEY is set", async () => {
      process.env.ZAI_API_KEY = "test-key-123";
      const provider = new ZaiAiProvider();
      expect(await provider.isAvailable()).toBe(true);
    });

    it("returns false when process.env.ZAI_API_KEY is unset", async () => {
      delete process.env.ZAI_API_KEY;
      const provider = new ZaiAiProvider();
      expect(await provider.isAvailable()).toBe(false);
    });

    // Adjacent: explicit apiKey in constructor takes precedence over env.
    it("returns true when apiKey is passed explicitly and env is unset", async () => {
      delete process.env.ZAI_API_KEY;
      const provider = new ZaiAiProvider({ apiKey: "explicit-key" });
      expect(await provider.isAvailable()).toBe(true);
    });

    // Adjacent: empty / whitespace-only key is treated as missing.
    it("returns false when ZAI_API_KEY is whitespace-only", async () => {
      process.env.ZAI_API_KEY = "   ";
      const provider = new ZaiAiProvider();
      expect(await provider.isAvailable()).toBe(false);
    });

    // Adjacent: isAvailable must NOT perform network I/O.
    it("does not call ZAI.create() (no network I/O on health check)", async () => {
      process.env.ZAI_API_KEY = "test-key";
      const provider = new ZaiAiProvider();
      await provider.isAvailable();
      expect(hoisted.createMock).not.toHaveBeenCalled();
    });
  });

  // ─── Tests 3, 4, 5: complete ───────────────────────────────────────────
  describe("complete", () => {
    beforeEach(() => {
      // Most tests in this block need a healthy env + working SDK.
      process.env.ZAI_API_KEY = "test-key";
      hoisted.chatCompletionsCreateMock.mockResolvedValue(FIXED_RESPONSE);
    });

    // Test 5: response field mapping (content, model, usage).
    it("maps response fields correctly (content, model, usage)", async () => {
      const provider = new ZaiAiProvider();
      const result = await provider.complete({
        messages: [{ role: "user", content: "hi" }],
      });

      expect(result.content).toBe("Hello, world!");
      expect(result.model).toBe("glm-4-plus");
      expect(result.usage).toEqual({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      });
    });

    // Test 3: proposal is always true (Constitution §3 #3).
    it("returns an AiCompletionResponse with proposal: true", async () => {
      const provider = new ZaiAiProvider();
      const result = await provider.complete({
        messages: [{ role: "user", content: "hi" }],
      });

      expect(result).toBeInstanceOf(Object);
      expect(result.proposal).toBe(true);
    });

    // Test 4: SDK errors are wrapped in AiProviderError.
    it("throws AiProviderError when the SDK throws", async () => {
      const sdkError = new Error("HTTP 500: internal server error");
      hoisted.chatCompletionsCreateMock.mockRejectedValue(sdkError);

      const provider = new ZaiAiProvider();
      await expect(
        provider.complete({ messages: [{ role: "user", content: "hi" }] }),
      ).rejects.toSatisfy((err: unknown) => {
        if (!(err instanceof AiProviderError)) return false;
        return (
          err.code === "REQUEST_FAILED" &&
          err.provider === "zai" &&
          err.cause === sdkError
        );
      });
    });

    // Adjacent: UNAVAILABLE when not configured.
    it("throws AiProviderError(UNAVAILABLE) when not available", async () => {
      delete process.env.ZAI_API_KEY;
      const provider = new ZaiAiProvider();

      await expect(
        provider.complete({ messages: [{ role: "user", content: "hi" }] }),
      ).rejects.toSatisfy((err: unknown) => {
        if (!(err instanceof AiProviderError)) return false;
        return err.code === "UNAVAILABLE" && err.provider === "zai";
      });

      // Provider should short-circuit before calling the SDK.
      expect(hoisted.chatCompletionsCreateMock).not.toHaveBeenCalled();
    });

    // Adjacent: empty response body.
    it("throws AiProviderError(EMPTY_RESPONSE) when content is missing", async () => {
      hoisted.chatCompletionsCreateMock.mockResolvedValue({
        model: "x",
        choices: [{ message: { content: "" } }],
      });

      const provider = new ZaiAiProvider();
      await expect(
        provider.complete({ messages: [{ role: "user", content: "hi" }] }),
      ).rejects.toSatisfy((err: unknown) => {
        if (!(err instanceof AiProviderError)) return false;
        return err.code === "EMPTY_RESPONSE" && err.provider === "zai";
      });
    });

    // Adjacent: ZAI.create() rejection is wrapped as UNAVAILABLE.
    it("throws AiProviderError(UNAVAILABLE) when ZAI.create() fails", async () => {
      hoisted.createMock.mockReset();
      hoisted.createMock.mockRejectedValue(
        new Error("Configuration file not found or invalid."),
      );

      const provider = new ZaiAiProvider();
      await expect(
        provider.complete({ messages: [{ role: "user", content: "hi" }] }),
      ).rejects.toSatisfy((err: unknown) => {
        if (!(err instanceof AiProviderError)) return false;
        return err.code === "UNAVAILABLE" && err.provider === "zai";
      });
    });

    // Adjacent: request body shape (messages forwarded verbatim, stream:false, thinking:disabled).
    it("forwards messages, stream, and thinking to the SDK", async () => {
      const provider = new ZaiAiProvider();
      const messages = [
        { role: "system" as const, content: "you are helpful" },
        { role: "user" as const, content: "ping" },
      ];
      await provider.complete({ messages });

      expect(hoisted.chatCompletionsCreateMock).toHaveBeenCalledTimes(1);
      const arg = hoisted.chatCompletionsCreateMock.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(arg.messages).toEqual(messages);
      expect(arg.stream).toBe(false);
      expect(arg.thinking).toEqual({ type: "disabled" });
    });

    // Adjacent: optional temperature / maxTokens forwarding.
    it("passes temperature and max_tokens when provided", async () => {
      const provider = new ZaiAiProvider();
      await provider.complete({
        messages: [{ role: "user", content: "hi" }],
        temperature: 0.7,
        maxTokens: 1024,
      });

      const arg = hoisted.chatCompletionsCreateMock.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(arg.temperature).toBe(0.7);
      expect(arg.max_tokens).toBe(1024);
    });

    // Adjacent: model fallback chain — request.model wins over config.model.
    it("prefers request.model over config.model when both are set", async () => {
      const provider = new ZaiAiProvider({ model: "config-default" });
      await provider.complete({
        messages: [{ role: "user", content: "hi" }],
        model: "request-override",
      });

      const arg = hoisted.chatCompletionsCreateMock.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(arg.model).toBe("request-override");
    });

    // Adjacent: config.model is used when request.model is absent.
    it("uses config.model when request.model is absent", async () => {
      const provider = new ZaiAiProvider({ model: "config-default" });
      await provider.complete({
        messages: [{ role: "user", content: "hi" }],
      });

      const arg = hoisted.chatCompletionsCreateMock.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(arg.model).toBe("config-default");
    });

    // Adjacent: missing usage fields default to zeros.
    it("falls back to zeros when usage fields are missing", async () => {
      hoisted.chatCompletionsCreateMock.mockResolvedValue({
        model: "glm-4-plus",
        choices: [{ message: { content: "ok" } }],
        // usage omitted entirely
      });

      const provider = new ZaiAiProvider();
      const result = await provider.complete({
        messages: [{ role: "user", content: "hi" }],
      });

      expect(result.usage).toEqual({
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      });
    });

    // Adjacent: response.model missing + no config.model → "zai-glm" fallback.
    it("uses 'zai-glm' as the final model fallback", async () => {
      hoisted.chatCompletionsCreateMock.mockResolvedValue({
        choices: [{ message: { content: "ok" } }],
        // no model, no usage
      });

      const provider = new ZaiAiProvider();
      const result = await provider.complete({
        messages: [{ role: "user", content: "hi" }],
      });

      expect(result.model).toBe("zai-glm");
    });

    // Adjacent: config.model still wins over final fallback when response omits model.
    it("uses config.model when response.model is missing", async () => {
      hoisted.chatCompletionsCreateMock.mockResolvedValue({
        choices: [{ message: { content: "ok" } }],
      });

      const provider = new ZaiAiProvider({ model: "glm-4-air" });
      const result = await provider.complete({
        messages: [{ role: "user", content: "hi" }],
      });

      expect(result.model).toBe("glm-4-air");
    });
  });
});
