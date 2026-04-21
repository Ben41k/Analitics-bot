import axios, { type AxiosInstance } from 'axios';
import { z } from 'zod';
import type { Config } from './config';

export type ChatRole = 'system' | 'user' | 'assistant';

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type ModelRole = 'primary' | 'longContext';

const chatCompletionResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable(),
        }),
      }),
    )
    .min(1),
});

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

export type LlmClient = {
  chatCompletion: (params: {
    messages: ChatMessage[];
    modelRole?: ModelRole;
    /** Явная модель; иначе берётся из config по modelRole */
    model?: string;
    temperature?: number;
    maxTokens?: number;
  }) => Promise<string>;
};

/**
 * Клиент чата совместимый с OpenRouter (и любым OpenAI-совместимым API при смене LLM_BASE_URL).
 */
export function createLlmClient(cfg: Config): LlmClient {
  const baseURL = normalizeBaseUrl(cfg.LLM_BASE_URL);
  const apiKey = cfg.OPENROUTER_API_KEY;

  const http: AxiosInstance = axios.create({
    baseURL,
    timeout: 120_000,
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...(cfg.OPENROUTER_HTTP_REFERER ? { 'HTTP-Referer': cfg.OPENROUTER_HTTP_REFERER } : {}),
      ...(cfg.OPENROUTER_APP_TITLE ? { 'X-Title': cfg.OPENROUTER_APP_TITLE } : {}),
    },
  });

  return {
    async chatCompletion({ messages, modelRole = 'primary', model, temperature, maxTokens }) {
      if (!apiKey) {
        throw new Error('OPENROUTER_API_KEY is not set; LLM requests are disabled');
      }

      const resolvedModel =
        model ?? (modelRole === 'longContext' ? cfg.LONG_CONTEXT_MODEL : cfg.PRIMARY_REASONING_MODEL);

      const { data } = await http.post<unknown>('/chat/completions', {
        model: resolvedModel,
        messages,
        ...(temperature !== undefined ? { temperature } : {}),
        ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
      });

      const parsed = chatCompletionResponseSchema.safeParse(data);
      if (!parsed.success) {
        throw new Error(`Unexpected chat/completions response shape: ${parsed.error.message}`);
      }

      const content = parsed.data.choices[0].message.content;
      if (content === null || content === undefined) {
        throw new Error('LLM returned empty message content');
      }

      return content;
    },
  };
}
