/**
 * IAiProvider — AI service abstraction (PLATFORM_PORTABILITY.md §3.1).
 *
 * Layer purity:
 *   This is an INTERFACE FILE. Per the eslint layer-purity rules in
 *   eslint.config.mjs, the `src/services/**` glob has no restricted-imports
 *   pattern attached — but this file deliberately imports nothing
 *   platform-specific so the interface itself stays portable across Next.js,
 *   Electron, Tauri, and React Native. Only @shared/* and stdlib types
 *   belong here.
 *
 * Constitution §3 non-negotiable #3: "AI proposes, engineer approves".
 *   This is enforced structurally by the interface itself: `complete()`
 *   returns an `AiCompletionResponse` whose `proposal` field is always `true`.
 *   The interface never writes to project data; the caller (an engineer-
 *   reviewed UI flow) must apply with human review.
 */

// ---------------------------------------------------------------------------
// Request / response shapes
// ---------------------------------------------------------------------------

export type AiMessageRole = "system" | "user" | "assistant";

export interface AiMessage {
  role: AiMessageRole;
  content: string;
}

export interface AiCompletionRequest {
  messages: AiMessage[];
  /** Model identifier; if omitted, the provider's default is used. */
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AiTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AiCompletionResponse {
  content: string;
  model: string;
  usage: AiTokenUsage;
  /**
   * AI never writes to project data directly — caller must apply with human
   * review. Constitution §3 non-negotiable #3: "AI proposes, engineer
   * approves". Always `true`; included as a structural guarantee at the type
   * level so the proposal contract cannot be silently violated.
   */
  proposal: boolean;
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export type AiProviderName = "zai" | "ollama" | "openai" | "anthropic";

export interface IAiProvider {
  /** Stable identifier for this provider — "zai" | "ollama" | "openai" | "anthropic". */
  readonly name: AiProviderName;
  /**
   * Health check. SHOULD NOT perform network I/O — typically just verifies
   * that the provider is configured (API key present, base URL set, etc.).
   * Keeping this cheap lets callers gate UI affordances without latency.
   */
  isAvailable(): Promise<boolean>;
  /**
   * Run a chat completion. Returns a PROPOSAL — never an applied effect.
   * Constitution §3 non-negotiable #3: the response is structurally a
   * proposal; the caller must apply with human review.
   */
  complete(request: AiCompletionRequest): Promise<AiCompletionResponse>;
  // Future (Phase 4+): stream?(request, onChunk): Promise<AiCompletionResponse>
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type AiProviderErrorCode =
  | "UNAVAILABLE" // env/key missing or provider not configured
  | "REQUEST_FAILED" // SDK threw on the request itself
  | "EMPTY_RESPONSE" // API returned no choices / no content
  | "UNKNOWN"; // unclassified

export interface AiProviderErrorInit {
  message: string;
  code: AiProviderErrorCode;
  provider: AiProviderName;
  cause?: unknown;
}

/**
 * Typed error wrapper for all AI provider failures.
 *
 * Wrapped (not rethrown as-is) so that callers can branch on `code` without
 * introspecting error messages. `cause` retains the original SDK error for
 * debugging. `provider` lets the future registry distinguish failures across
 * multiple providers (zai, ollama, …) without instanceof checks.
 */
export class AiProviderError extends Error {
  readonly code: AiProviderErrorCode;
  readonly provider: AiProviderName;
  readonly cause?: unknown;

  constructor(init: AiProviderErrorInit) {
    super(init.message);
    this.name = "AiProviderError";
    this.code = init.code;
    this.provider = init.provider;
    this.cause = init.cause;
    // Restore prototype chain after the super() call — required when
    // subclassing Error under strict ES5/ES2017 targets so that
    // `instanceof AiProviderError` works after transpilation.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
