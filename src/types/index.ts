export type AIMode =
  | "corrigir_portugues"
  | "melhorar_texto"
  | "resumir"
  | "gerar_gc";

export interface AIModeConfig {
  id: AIMode;
  label: string;
  icon: string;
  description: string;
}

export interface HistoryEntry {
  id: string;
  original_text: string;
  result_text: string;
  mode: AIMode;
  created_at: string;
}

export interface AppSettings {
  apiKeys: Record<string, string>;
  apiProvider: "openai" | "claude" | "groq" | "openrouter" | "gemini";
  model: string;
  maxTextLength: number;
  saveHistory: boolean;
  windowMode: "popup" | "window";
  theme: "light" | "dark";
  toolbarEnabled: boolean;
  lastMode?: AIMode;
}

export interface AIResult {
  text: string;
  mode: AIMode;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUSD?: number;
}
