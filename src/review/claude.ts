// The Claude adapter of the LLM reviewer port (review layer 3): one Messages API call per refresh, with the answer
// constrained to the reviewer's schema (structured outputs) and validated against it again on arrival. Anything but a
// complete, valid answer throws, which the layer reports as a problem: an API error, a timeout, a refusal, an answer
// cut off, malformed JSON or a missing field never passes.
//
// Server-side refusal fallbacks are deliberately off: a fallback would change which model reviewed the diff, and a
// refusal should simply escalate to the maintainer.
import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ReviewerOutputSchema, schemaIssues, type LlmReviewer, type ReviewRequest } from "./llm.ts";

/**
 * The default model. The spec asks for a model independent from the one used to develop the parser
 * (`claude-opus-5-5`); the daily job sets `AKOMA_REVIEW_MODEL` to override it.
 */
export const DEFAULT_REVIEW_MODEL = "claude-opus-5";

/** The prompt file's name is its version, recorded with every answer; a new prompt is a new file. */
export const PROMPT_VERSION = "llm-reviewer.v1";
const PROMPT = new URL(`./prompts/${PROMPT_VERSION}.md`, import.meta.url);

export interface ClaudeReviewerOptions {
  /** Always explicit (the repository secret): the adapter never falls back to credentials found on the machine. */
  apiKey: string;
  model?: string;
  /** Per attempt, in milliseconds. Default 10 minutes. */
  timeoutMs?: number;
  /** Retries on 408/409/429/5xx and connection errors. Default 2. */
  maxRetries?: number;
  maxTokens?: number;
  /** Replaces the network, for tests over handwritten responses. */
  fetch?: typeof fetch;
}

export function claudeReviewer({
  apiKey,
  model = DEFAULT_REVIEW_MODEL,
  timeoutMs = 600_000,
  maxRetries = 2,
  maxTokens = 16_000,
  fetch,
}: ClaudeReviewerOptions): LlmReviewer {
  const client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries, ...(fetch && { fetch }) });
  const format = zodOutputFormat(ReviewerOutputSchema);
  const system = readFileSync(PROMPT, "utf8");

  return {
    async review(request) {
      let response: Anthropic.Message;
      try {
        response = await client.messages.create({
          model,
          max_tokens: maxTokens,
          system,
          thinking: { type: "adaptive" },
          output_config: { effort: "high", format },
          messages: [{ role: "user", content: userContent(request) }],
        });
      } catch (error) {
        throw new Error(apiFailure(error, timeoutMs));
      }

      const who = response.model;
      if (response.stop_reason === "refusal") {
        const details = response.stop_details;
        throw new Error(`${who} refused to answer (category ${details?.category ?? "none"}${details?.explanation ? `: ${details.explanation}` : ""})`);
      }
      if (response.stop_reason !== "end_turn") throw new Error(`${who} stopped before finishing (${response.stop_reason})`);
      const texts = response.content.filter((block) => block.type === "text");
      if (texts.length !== 1) throw new Error(`${who} answered with ${texts.length} text blocks instead of one`);
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

/** The acts' text and the diff, each in its own block, as the prompt describes them. */
function userContent({ acts, changes }: ReviewRequest): Anthropic.TextBlockParam[] {
  const attribute = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return [
    ...acts.map(({ act, url, inDataset, text }) => ({
      type: "text" as const,
      text: `<amending_act act="${attribute(act)}" url="${attribute(url)}" in_dataset="${inDataset}">\n${text}\n</amending_act>`,
    })),
    { type: "text", text: `<diff>\n${JSON.stringify(changes)}\n</diff>` },
  ];
}

function apiFailure(error: unknown, timeoutMs: number): string {
  if (error instanceof Anthropic.APIConnectionTimeoutError) return `the Claude API did not answer within ${timeoutMs} ms`;
  if (error instanceof Anthropic.APIConnectionError) return `the Claude API could not be reached: ${error.message}`;
  if (error instanceof Anthropic.APIError) {
    // The error body's own message ("Internal server error"), without the status and JSON the SDK prefixes.
    const body = error.error as { error?: { message?: unknown } } | undefined;
    const message = typeof body?.error?.message === "string" ? body.error.message : error.message;
    return `the Claude API answered ${error.status ?? "an error"}: ${message}`;
  }
  return `the Claude API call failed: ${(error as Error).message}`;
}
