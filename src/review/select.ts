// Which LLM reviewer (review layer 3) a run uses, from its environment: `AKOMA_REVIEW_PROVIDER` names the provider
// (`openai` or `anthropic`); unset or empty (an unset Actions variable reads as ""), OpenAI when `OPENAI_API_KEY` is
// set, else Claude when `ANTHROPIC_API_KEY` is, else none. `AKOMA_REVIEW_MODEL` overrides the provider's default model.
// A named provider without its key, or a provider Akoma does not know, gives no reviewer and a reason, never the other
// provider: the job turns that into a blocking finding (ADR 0006).
//
// The only place that reads these variables; the adapters take everything as arguments.
import { claudeReviewer, DEFAULT_REVIEW_MODEL } from "./claude.ts";
import type { LlmReviewer } from "./llm.ts";
import { DEFAULT_OPENAI_REVIEW_MODEL, openaiReviewer } from "./openai.ts";

export type ReviewProvider = "openai" | "anthropic";

/** What `runDailyJob` takes about the reviewer: spread into its input. */
export type ReviewerSelection =
  | { reviewer: LlmReviewer; reviewerProvider: string; reviewerModel: string }
  | { reviewer: undefined; reviewerUnavailable: string };

/** Passed to the adapter: tests replace the network. */
export interface SelectOptions {
  fetch?: typeof fetch;
  maxRetries?: number;
}

const PROVIDERS: Record<ReviewProvider, { name: string; key: string; model: string; make: (apiKey: string, model: string, options: SelectOptions) => LlmReviewer }> = {
  openai: { name: "OpenAI", key: "OPENAI_API_KEY", model: DEFAULT_OPENAI_REVIEW_MODEL, make: (apiKey, model, o) => openaiReviewer({ apiKey, model, ...o }) },
  anthropic: { name: "Anthropic", key: "ANTHROPIC_API_KEY", model: DEFAULT_REVIEW_MODEL, make: (apiKey, model, o) => claudeReviewer({ apiKey, model, ...o }) },
};

export function selectReviewer(env: Record<string, string | undefined>, options: SelectOptions = {}): ReviewerSelection {
  const named = env.AKOMA_REVIEW_PROVIDER || undefined;
  let provider: ReviewProvider;
  if (named === undefined) {
    const found = (["openai", "anthropic"] as const).find((p) => env[PROVIDERS[p].key]);
    if (!found) return { reviewer: undefined, reviewerUnavailable: "no API key (neither OPENAI_API_KEY nor ANTHROPIC_API_KEY is set)" };
    provider = found;
  } else if (named === "openai" || named === "anthropic") {
    provider = named;
  } else {
    return { reviewer: undefined, reviewerUnavailable: `unknown provider (AKOMA_REVIEW_PROVIDER is ${JSON.stringify(named)}; it must be openai or anthropic)` };
  }

  const { name, key, model: defaultModel, make } = PROVIDERS[provider];
  const apiKey = env[key];
  if (!apiKey) return { reviewer: undefined, reviewerUnavailable: `no API key (AKOMA_REVIEW_PROVIDER is ${provider} and ${key} is not set)` };
  const model = env.AKOMA_REVIEW_MODEL || defaultModel;
  return { reviewer: make(apiKey, model, options), reviewerProvider: name, reviewerModel: model };
}
