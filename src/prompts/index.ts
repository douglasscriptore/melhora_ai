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
  gerar_gc: `A partir do texto abaixo, gere um título e um subtítulo no formato Gerador de Caracteres para exibição em painel.

Regras obrigatórias:
- LINHA 1 (Título): máximo 61 caracteres, TUDO EM MAIÚSCULO
- LINHA 2 (Subtítulo): máximo 79 caracteres, sem padrão de capitalização obrigatório

Retorne SOMENTE as 2 linhas, uma por linha, sem numeração, sem rótulos, sem explicações.

Texto:
`,
};

export function buildPrompt(mode: AIMode, text: string): string {
  return PROMPTS[mode] + text;
}
