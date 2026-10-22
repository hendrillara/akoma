// The OpenAI adapter of the LLM reviewer port (review layer 3), held to the Claude adapter's contract (claude.ts): one
// Responses API call per refresh, with the same versioned prompt, the answer constrained to the reviewer's schema
// (Structured Outputs, `text.format` of type `json_schema`, strict) and validated against it again on arrival. Anything
// but a complete, valid answer throws, which the layer reports as a problem: an API error, a timeout, a refusal, an
// answer cut off (`status: "incomplete"`), malformed JSON or a missing field never passes.
//
// The Responses API, not Chat Completions: OpenAI's docs recommend it for reasoning models and document Structured
// Outputs on it (https://developers.openai.com/api/docs/guides/structured-outputs, and for reasoning models
// https://developers.openai.com/api/docs/guides/reasoning?api-mode=responses; both read 2026-10-22).
//
// One model, no fallback: the answer names the model that answered (`response.model`), and nothing retries the
// request on another model.
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { PROMPT_VERSION, requestTexts, reviewerPrompt, ReviewerOutputSchema, schemaIssues, type LlmReviewer } from "./llm.ts";

/**
 * The default model when the reviewer is OpenAI's: a different vendor from the model family the parser was developed
 * with (ADR 0006). The daily job sets `AKOMA_REVIEW_MODEL` to override it.
 */
export const DEFAULT_OPENAI_REVIEW_MODEL = "gpt-6-luna";

/** The one endpoint the adapter calls, fixed so that no `OPENAI_BASE_URL` on the machine can redirect the request. */
const BASE_URL = "https://api.openai.com/v1";

export interface OpenAIReviewerOptions {
  /** Always explicit (the repository secret): the adapter never falls back to credentials found on the machine. */
  apiKey: string;
  model?: string;
  /** Per attempt, in milliseconds. Default 10 minutes. */
  timeoutMs?: number;
  /** Retries on 408/409/429/5xx and connection errors. Default 2. */
  maxRetries?: number;
  /** Reasoning and answer together; OpenAI suggests reserving at least 25,000 for reasoning models. */
  maxOutputTokens?: number;
  /** Replaces the network, for tests over handwritten responses. */
  fetch?: typeof fetch;
}

export function openaiReviewer({
  apiKey,
  model = DEFAULT_OPENAI_REVIEW_MODEL,
  timeoutMs = 600_000,
  maxRetries = 2,
  maxOutputTokens = 32_000,
  fetch,
}: OpenAIReviewerOptions): LlmReviewer {
  // Every option the SDK would otherwise read from the environment is given (base URL, admin key, organization,
  // project, webhook secret, log level), so the request depends on these arguments only.
  const client = new OpenAI({
    apiKey,
    adminAPIKey: null,
    organization: null,
    project: null,
    webhookSecret: null,
    baseURL: BASE_URL,
    logLevel: "warn",
    timeout: timeoutMs,
    maxRetries,
    ...(fetch && { fetch }),
  });
  const format = zodTextFormat(ReviewerOutputSchema, "reviewer_output");
  const instructions = reviewerPrompt();

  return {
    async review(request) {
      let response: OpenAI.Responses.Response;
      try {
        response = await client.responses.create({
          model,
          instructions,
          input: [{ role: "user", content: requestTexts(request).map((text) => ({ type: "input_text" as const, text })) }],
          text: { format },
          reasoning: { effort: "high" },
          max_output_tokens: maxOutputTokens,
          // Nothing kept on OpenAI's side: each refresh is one self-contained call.
          store: false,
        });
      } catch (error) {
        throw new Error(apiFailure(error, timeoutMs));
      }

      const who = response.model;
      if (response.error) throw new Error(`${who} failed to answer (${response.error.code}: ${response.error.message})`);
      if (response.status === "incomplete") {
        throw new Error(`${who} stopped before finishing (${response.incomplete_details?.reason ?? "incomplete"})`);
      }
      if (response.status !== "completed") throw new Error(`${who} stopped before finishing (status ${response.status})`);
      const messages = response.output.filter((item) => item.type === "message");
      const content = messages.flatMap((m) => m.content);
      const refusal = content.find((c) => c.type === "refusal");
      if (refusal) throw new Error(`${who} refused to answer: ${refusal.refusal}`);
      // Never the SDK's `output_text`, which joins every text it finds: the answer must be one text, alone.
      const texts = content.filter((c) => c.type === "output_text");
      if (messages.length !== 1 || texts.length !== 1 || content.length !== 1) {
        throw new Error(`${who} answered with ${messages.length} messages and ${texts.length} texts instead of one`);
      }
      let json: unknown;
      try {
        json = JSON.parse(texts[0]!.text);
      } catch (error) {
        throw new Error(`${who}'s answer is not the reviewer's schema: it is not JSON (${(error as Error).message})`);
      }
      const output = ReviewerOutputSchema.safeParse(json);
      if (!output.success) throw new Error(`${who}'s answer is not the reviewer's schema: ${schemaIssues(output.error)}`);
      return { model: who, prompt: PROMPT_VERSION, output: output.data };
    },
  };
}

function apiFailure(error: unknown, timeoutMs: number): string {
  if (error instanceof OpenAI.APIConnectionTimeoutError) return `the OpenAI API did not answer within ${timeoutMs} ms`;
  if (error instanceof OpenAI.APIConnectionError) return `the OpenAI API could not be reached: ${error.message}`;
  if (error instanceof OpenAI.APIError) {
    // The error body's own message, without the status the SDK prefixes.
    const body = error.error as { message?: unknown } | undefined;
    const message = typeof body?.message === "string" ? body.message : error.message;
    return `the OpenAI API answered ${error.status ?? "an error"}: ${message}`;
  }
  return `the OpenAI API call failed: ${(error as Error).message}`;
}
