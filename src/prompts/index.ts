import { AIMode } from "../types";

export const PROMPTS: Record<AIMode, string> = {
  corrigir_portugues: `Corrija o português do texto abaixo mantendo o sentido original. Não invente informações. Não explique as correções. Retorne apenas o texto final corrigido.

Texto:
`,
  melhorar_texto: `Melhore a clareza, fluidez e legibilidade do texto abaixo mantendo o tom original e sem alterar o significado. Não explique as mudanças. Retorne apenas o texto melhorado.

Texto:
`,
  resumir: `Resuma o texto abaixo de forma clara e objetiva, mantendo os pontos principais. Retorne apenas o resumo, sem introduções como "O texto fala sobre..." ou "Resumo:".

Texto:
`,
};

export function buildPrompt(mode: AIMode, text: string): string {
  return PROMPTS[mode] + text;
}
