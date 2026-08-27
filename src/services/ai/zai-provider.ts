/**
 * ZaiAiProvider — concrete IAiProvider over the `z-ai-web-dev-sdk`.
 *
 * Architecture (per PLATFORM_PORTABILITY.md §3.1 + §4.1):
 *   - Imports `z-ai-web-dev-sdk` (platform SDK; permitted in `src/services/**`
 *     per eslint.config.mjs — the services layer has no restricted-imports
 *     rule attached, only the layer-purity rules for shared/domain/components
 *     are enforced mechanically).
 *   - Does NOT import `next`, `react`, or `@prisma/client` — the AI provider
 *     never touches the DB directly. Constitution §3 non-negotiable #3:
 *     "AI proposes, engineer approves" — `complete()` returns a proposal; the
 *     caller applies it after human review.
 *
 * SDK behaviour notes:
 *   - `ZAI.create()` returns a singleton instance. It reads configuration from
 *     `.z-ai-config` files (project / home / /etc) — it does NOT directly
 *     read `ZAI_API_KEY` from env at the SDK layer. The provider's
 *     `isAvailable()` check still gates on `process.env.ZAI_API_KEY` (and/or
 *     an explicitly-passed `apiKey`) because the project's convention is that
 *     the presence of that env var is the contract for "AI is configured in
 *     this deployment". If `.z-ai-config` is missing at call time, the SDK
 *     will throw and we surface that as an `AiProviderError(REQUEST_FAILED)`.
 *   - The chat completion response is OpenAI-shaped: `choices[0].message.
 *     content`, `model`, `usage.{prompt_tokens,completion_tokens,total_tokens}`.
 *     The SDK's .d.ts types this as `any`, so we declare a narrow structural
 *     view (`ZaiChatCompletionResponse`) for safe field access.
 */

import ZAI, { type CreateChatCompletionBody } from "z-ai-web-dev-sdk";
import {
  AiProviderError,
  type AiCompletionRequest,
  type AiCompletionResponse,
  type AiProviderName,
  type IAiProvider,
} from "@services/ai/types";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface ZaiAiProviderConfig {
  /**
   * Explicit API key. If omitted, `isAvailable()` falls back to
   * `process.env.ZAI_API_KEY`. (Note: the SDK itself reads from
   * `.z-ai-config`, not env — this field is the caller-side contract.)
   */
  apiKey?: string;
  /** Default model passed to the SDK when the per-request `model` is unset. */
  model?: string;
}

/** Final fallback for `AiCompletionResponse.model` when neither the SDK nor config supply one. */
const DEFAULT_MODEL_FALLBACK = "zai-glm";

/**
 * Narrow structural view of the SDK's chat completion response.
 * The SDK's .d.ts returns `any`; this interface lets us access fields safely.
 */
interface ZaiChatCompletionResponse {
  model?: string;
  choices?: Array<{
    message?: { role?: string; content?: string };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class ZaiAiProvider implements IAiProvider {
  readonly name: AiProviderName = "zai";
  private readonly apiKey?: string;
  private readonly defaultModel?: string;

  constructor(config: ZaiAiProviderConfig = {}) {
    this.apiKey = config.apiKey;
    this.defaultModel = config.model;
  }

  async isAvailable(): Promise<boolean> {
    // Health check must NOT perform network I/O — we don't want unit tests
    // or UI affordance checks to depend on connectivity. An explicit key
    // passed to the constructor takes precedence over env.
    const key = this.apiKey ?? process.env.ZAI_API_KEY;
    return typeof key === "string" && key.trim().length > 0;
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletionResponse> {
    if (!(await this.isAvailable())) {
      throw new AiProviderError({
        message:
          "ZAI API key not configured. Set ZAI_API_KEY or pass apiKey to ZaiAiProvider.",
        code: "UNAVAILABLE",
        provider: "zai",
      });
    }

    let zai: ZAI;
    try {
      // ZAI.create() returns a singleton. It reads .z-ai-config from disk;
      // if missing it throws — we surface that as UNAVAILABLE because the
      // deployment isn't ready to call the API.
      zai = await ZAI.create();
    } catch (err) {
      throw new AiProviderError({
        message: `Failed to initialize ZAI client: ${
          (err as Error)?.message ?? String(err)
        }`,
        code: "UNAVAILABLE",
        provider: "zai",
        cause: err,
      });
    }

    // Build the request body. The SDK accepts the OpenAI-style fields
    // (messages, model, temperature, max_tokens, stream, thinking) — we
    // forward each optional field only when set so the SDK's defaults apply
    // otherwise. The SDK's CreateChatCompletionBody type uses an index
    // signature `[key: string]: any`, so it accepts arbitrary extra fields
    // like `max_tokens` (which OpenAI uses) without complaint.
    const body: CreateChatCompletionBody = {
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      stream: false,
      thinking: { type: "disabled" },
      ...(request.model !== undefined ? { model: request.model } : {}),
      ...(this.defaultModel !== undefined && request.model === undefined
        ? { model: this.defaultModel }
        : {}),
      ...(request.temperature !== undefined
        ? { temperature: request.temperature }
        : {}),
      ...(request.maxTokens !== undefined
        ? { max_tokens: request.maxTokens }
        : {}),
    };

    let response: ZaiChatCompletionResponse;
    try {
      response = (await zai.chat.completions.create(
        body,
      )) as ZaiChatCompletionResponse;
    } catch (err) {
      throw new AiProviderError({
        message: `ZAI chat completion failed: ${
          (err as Error)?.message ?? String(err)
        }`,
        code: "REQUEST_FAILED",
        provider: "zai",
        cause: err,
      });
    }

    const choice = response?.choices?.[0];
    const content = choice?.message?.content;
    if (content === undefined || content === null || content === "") {
      throw new AiProviderError({
        message:
          "ZAI returned an empty response (no choices[0].message.content).",
        code: "EMPTY_RESPONSE",
        provider: "zai",
      });
    }

    const usage = response?.usage ?? {};
    return {
      content,
      model:
        response.model ?? this.defaultModel ?? DEFAULT_MODEL_FALLBACK,
      usage: {
        promptTokens: usage.prompt_tokens ?? 0,
        completionTokens: usage.completion_tokens ?? 0,
        totalTokens: usage.total_tokens ?? 0,
      },
      // Constitution §3 non-negotiable #3: "AI proposes, engineer approves".
      // Always `true` — this is the structural guarantee enforced by the
      // interface type. The provider cannot opt out of being a proposal.
      proposal: true,
    };
  }
}
