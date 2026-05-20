import { AIMode, AIResult, AppSettings } from "../types";
import { buildPrompt } from "../prompts";

const OPENAI_MODELS = ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"];
const CLAUDE_MODELS = ["claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-7"];

export const MODEL_LABELS: Record<string, string> = {
  "gpt-4o-mini":             "GPT-4o Mini",
  "gpt-4o":                  "GPT-4o",
  "gpt-4-turbo":             "GPT-4 Turbo",
  "gpt-3.5-turbo":           "GPT-3.5 Turbo",
  "claude-haiku-4-5-20251001": "Claude Haiku 4.5",
  "claude-sonnet-4-6":       "Claude Sonnet 4.6",
  "claude-opus-4-7":         "Claude Opus 4.7",
};

export { OPENAI_MODELS, CLAUDE_MODELS };

async function callOpenAI(settings: AppSettings, prompt: string): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model || "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 2048,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `OpenAI error ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0]?.message?.content?.trim() ?? "";
}

async function callClaude(settings: AppSettings, prompt: string): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": settings.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: settings.model || "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Claude error ${response.status}`);
  }

  const data = await response.json();
  return data.content[0]?.text?.trim() ?? "";
}

export async function processText(
  text: string,
  mode: AIMode,
  settings: AppSettings
): Promise<AIResult> {
  if (!settings.apiKey) throw new Error("Chave de API não configurada. Acesse as Configurações.");

  const maxLen = settings.maxTextLength || 8000;
  if (text.length > maxLen) {
    throw new Error(`Texto muito longo (${text.length} caracteres). Máximo permitido: ${maxLen}.`);
  }

  const prompt = buildPrompt(mode, text);

  let result: string;
  if (settings.apiProvider === "claude") {
    result = await callClaude(settings, prompt);
  } else {
    result = await callOpenAI(settings, prompt);
  }

  return { text: result, mode };
}
