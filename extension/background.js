// Melhora.AI — background service worker
// Handles AI API calls so content script doesn't need host_permissions directly.

const PROMPTS = {
  corrigir_portugues: `Corrija o português do texto abaixo mantendo o sentido original. Não invente informações. Não explique as correções. Retorne apenas o texto final corrigido.\n\nTexto:\n`,
  melhorar_texto: `Melhore a clareza, fluidez e legibilidade do texto abaixo mantendo o tom original e sem alterar o significado. Não explique as mudanças. Retorne apenas o texto melhorado.\n\nTexto:\n`,
  resumir: `Resuma o texto abaixo de forma clara e objetiva, mantendo os pontos principais. Retorne apenas o resumo, sem introduções como "O texto fala sobre..." ou "Resumo:".\n\nTexto:\n`,
  gerar_gc: `A partir do texto abaixo, gere um título e um subtítulo no formato Gerador de Caracteres para exibição em painel.\n\nRegras obrigatórias:\n- LINHA 1 (Título): máximo 61 caracteres, TUDO EM MAIÚSCULO\n- LINHA 2 (Subtítulo): máximo 79 caracteres, sem padrão de capitalização obrigatório\n\nRetorne SOMENTE as 2 linhas, uma por linha, sem numeração, sem rótulos, sem explicações.\n\nTexto:\n`,
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "PROCESS_TEXT") {
    processText(message.text, message.mode)
      .then((text) => sendResponse({ ok: true, text }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // keep channel open for async response
  }

  if (message.type === "GET_SETTINGS") {
    chrome.storage.sync.get(["provider", "model", "apiKey"]).then((s) => sendResponse(s));
    return true;
  }
});

async function processText(text, mode) {
  const settings = await chrome.storage.sync.get(["provider", "model", "apiKey"]);
  const provider = settings.provider || "openai";
  const apiKey = settings.apiKey || "";

  if (!apiKey) {
    throw new Error("Chave de API não configurada. Clique no ícone da extensão para configurar.");
  }

  const prompt = (PROMPTS[mode] ?? PROMPTS.corrigir_portugues) + text;

  switch (provider) {
    case "openai":
      return callOpenAI(apiKey, settings.model || "gpt-4o-mini", prompt);
    case "claude":
      return callClaude(apiKey, settings.model || "claude-haiku-4-5-20251001", prompt);
    case "groq":
      return callGroq(apiKey, settings.model || "llama-3.3-70b-versatile", prompt);
    case "openrouter":
      return callOpenRouter(apiKey, settings.model || "meta-llama/llama-3.3-70b-instruct:free", prompt);
    case "gemini":
      return callGemini(apiKey, settings.model || "gemini-2.0-flash", prompt);
    default:
      throw new Error(`Provider desconhecido: ${provider}`);
  }
}

async function callOpenAI(apiKey, model, prompt) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 2048,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content.trim();
}

async function callClaude(apiKey, model, prompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.content[0].text.trim();
}

async function callGroq(apiKey, model, prompt) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 2048,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content.trim();
}

async function callOpenRouter(apiKey, model, prompt) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://melhoraai.app",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 2048,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content.trim();
}

async function callGemini(apiKey, model, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 2048 },
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.candidates[0].content.parts[0].text.trim();
}
