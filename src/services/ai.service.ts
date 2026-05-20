import { AIMode, AIResult, AppSettings } from "../types";
import { buildPrompt } from "../prompts";

export const PROVIDER_MODELS: Record<string, string[]> = {
  openai:     ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"],
  claude:     ["claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-7"],
  groq:       ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "gemma2-9b-it", "mixtral-8x7b-32768"],
  openrouter: ["meta-llama/llama-3.3-70b-instruct:free", "google/gemma-3-27b-it:free", "mistralai/mistral-7b-instruct:free", "qwen/qwen2.5-72b-instruct:free"],
  gemini:     ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"],
};

export const MODEL_LABELS: Record<string, string> = {
  "gpt-4o-mini":    "GPT-4o Mini",
  "gpt-4o":         "GPT-4o",
  "gpt-4-turbo":    "GPT-4 Turbo",
  "gpt-3.5-turbo":  "GPT-3.5 Turbo",
  "claude-haiku-4-5-20251001": "Claude Haiku 4.5",
  "claude-sonnet-4-6":         "Claude Sonnet 4.6",
  "claude-opus-4-7":           "Claude Opus 4.7",
  "llama-3.3-70b-versatile":   "Llama 3.3 70B",
  "llama-3.1-8b-instant":      "Llama 3.1 8B",
  "gemma2-9b-it":              "Gemma 2 9B",
  "mixtral-8x7b-32768":        "Mixtral 8x7B",
  "meta-llama/llama-3.3-70b-instruct:free": "Llama 3.3 70B",
  "google/gemma-3-27b-it:free":             "Gemma 3 27B",
  "mistralai/mistral-7b-instruct:free":     "Mistral 7B",
  "qwen/qwen2.5-72b-instruct:free":         "Qwen 2.5 72B",
  "gemini-2.0-flash": "Gemini 2.0 Flash",
  "gemini-1.5-flash": "Gemini 1.5 Flash",
  "gemini-1.5-pro":   "Gemini 1.5 Pro",
};

export const PROVIDER_NAMES: Record<string, string> = {
  openai:     "OpenAI",
  claude:     "Anthropic",
  groq:       "Groq",
  openrouter: "OpenRouter",
  gemini:     "Google",
};

// USD per 1K tokens — approximate, updated 2025
const COST_PER_1K: Record<string, { in: number; out: number }> = {
  "gpt-4o-mini":               { in: 0.00015,  out: 0.0006  },
  "gpt-4o":                    { in: 0.0025,   out: 0.01    },
  "gpt-4-turbo":               { in: 0.01,     out: 0.03    },
  "gpt-3.5-turbo":             { in: 0.0005,   out: 0.0015  },
  "claude-haiku-4-5-20251001": { in: 0.00025,  out: 0.00125 },
  "claude-sonnet-4-6":         { in: 0.003,    out: 0.015   },
  "claude-opus-4-7":           { in: 0.015,    out: 0.075   },
  "gemini-2.0-flash":          { in: 0.0001,   out: 0.0004  },
  "gemini-1.5-flash":          { in: 0.000075, out: 0.0003  },
  "gemini-1.5-pro":            { in: 0.00125,  out: 0.005   },
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const c = COST_PER_1K[model];
  if (!c) return 0;
  return (inputTokens / 1000) * c.in + (outputTokens / 1000) * c.out;
}

type ChunkCallback = (chunk: string) => void;

// ── SSE helper ──────────────────────────────────────────────────────────────
async function readSSE(
  response: Response,
  onLine: (data: string) => void,
): Promise<void> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("data: ")) onLine(line.slice(6).trim());
    }
  }
}

// ── OpenAI-compatible (OpenAI · Groq · OpenRouter) ──────────────────────────
async function callOpenAICompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  onChunk: ChunkCallback,
  extraHeaders: Record<string, string> = {},
): Promise<{ text: string; inputTokens?: number; outputTokens?: number }> {
  const isOpenAI = baseUrl.includes("openai.com");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, ...extraHeaders },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 2048,
      stream: true,
      ...(isOpenAI ? { stream_options: { include_usage: true } } : {}),
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Erro ${response.status}`);
  }

  let text = "";
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;

  await readSSE(response, (data) => {
    if (data === "[DONE]") return;
    try {
      const j = JSON.parse(data);
      const chunk = j.choices?.[0]?.delta?.content;
      if (chunk) { text += chunk; onChunk(chunk); }
      if (j.usage) {
        inputTokens  = j.usage.prompt_tokens;
        outputTokens = j.usage.completion_tokens;
      }
    } catch { /* ignore malformed chunks */ }
  });

  return { text, inputTokens, outputTokens };
}

// ── Claude ──────────────────────────────────────────────────────────────────
async function callClaude(
  apiKey: string,
  model: string,
  prompt: string,
  onChunk: ChunkCallback,
): Promise<{ text: string; inputTokens?: number; outputTokens?: number }> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model, max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
      stream: true,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Erro Claude ${response.status}`);
  }

  let text = "";
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;

  await readSSE(response, (data) => {
    try {
      const j = JSON.parse(data);
      if (j.type === "message_start")
        inputTokens = j.message?.usage?.input_tokens;
      if (j.type === "content_block_delta" && j.delta?.type === "text_delta") {
        text += j.delta.text; onChunk(j.delta.text);
      }
      if (j.type === "message_delta")
        outputTokens = j.usage?.output_tokens;
    } catch { /* ignore */ }
  });

  return { text, inputTokens, outputTokens };
}

// ── Gemini ──────────────────────────────────────────────────────────────────
async function callGemini(
  apiKey: string,
  model: string,
  prompt: string,
  onChunk: ChunkCallback,
): Promise<{ text: string; inputTokens?: number; outputTokens?: number }> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
      }),
    },
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Erro Gemini ${response.status}`);
  }

  let text = "";
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;

  await readSSE(response, (data) => {
    try {
      const j = JSON.parse(data);
      const chunk = j.candidates?.[0]?.content?.parts?.[0]?.text;
      if (chunk) { text += chunk; onChunk(chunk); }
      if (j.usageMetadata) {
        inputTokens  = j.usageMetadata.promptTokenCount;
        outputTokens = j.usageMetadata.candidatesTokenCount;
      }
    } catch { /* ignore */ }
  });

  return { text, inputTokens, outputTokens };
}

// ── Public API ───────────────────────────────────────────────────────────────
export async function processText(
  text: string,
  mode: AIMode,
  settings: AppSettings,
  onChunk: ChunkCallback,
): Promise<AIResult> {
  const apiKey = settings.apiKeys[settings.apiProvider] ?? "";
  if (!apiKey) throw new Error("Chave de API não configurada. Acesse as Configurações.");

  const maxLen = settings.maxTextLength || 8000;
  if (text.length > maxLen)
    throw new Error(`Texto muito longo (${text.length} caracteres). Máximo permitido: ${maxLen}.`);

  const prompt = buildPrompt(mode, text);
  const { model, apiProvider } = settings;

  let res: { text: string; inputTokens?: number; outputTokens?: number };

  switch (apiProvider) {
    case "claude":
      res = await callClaude(apiKey, model, prompt, onChunk);
      break;
    case "groq":
      res = await callOpenAICompatible("https://api.groq.com/openai/v1", apiKey, model, prompt, onChunk);
      break;
    case "openrouter":
      res = await callOpenAICompatible("https://openrouter.ai/api/v1", apiKey, model, prompt, onChunk, {
        "HTTP-Referer": "https://melhoraai.app",
        "X-Title": "Melhora.AI",
      });
      break;
    case "gemini":
      res = await callGemini(apiKey, model, prompt, onChunk);
      break;
    default:
      res = await callOpenAICompatible("https://api.openai.com/v1", apiKey, model, prompt, onChunk);
  }

  const estimatedCostUSD = res.inputTokens !== undefined && res.outputTokens !== undefined
    ? estimateCost(model, res.inputTokens, res.outputTokens)
    : undefined;

  return { text: res.text, mode, inputTokens: res.inputTokens, outputTokens: res.outputTokens, estimatedCostUSD };
}
