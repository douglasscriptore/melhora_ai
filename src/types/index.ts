export type AIMode =
  | "corrigir_portugues"
  | "melhorar_texto"
  | "resumir";

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
  apiKey: string;
  apiProvider: "openai" | "claude";
  model: string;
  maxTextLength: number;
  saveHistory: boolean;
  windowMode: "popup" | "window";
  theme: "light" | "dark";
}

export interface AIResult {
  text: string;
  mode: AIMode;
  tokensUsed?: number;
}
