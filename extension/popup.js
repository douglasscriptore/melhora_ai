// Melhora.AI popup settings

const MODELS = {
  openai:     ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"],
  claude:     ["claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-7"],
  groq:       ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "gemma2-9b-it"],
  openrouter: ["meta-llama/llama-3.3-70b-instruct:free", "google/gemma-3-27b-it:free", "mistralai/mistral-7b-instruct:free"],
  gemini:     ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"],
};

const MODEL_LABELS = {
  "gpt-4o-mini":    "GPT-4o Mini (recomendado)",
  "gpt-4o":         "GPT-4o",
  "gpt-4-turbo":    "GPT-4 Turbo",
  "gpt-3.5-turbo":  "GPT-3.5 Turbo",
  "claude-haiku-4-5-20251001": "Haiku 4.5 (rápido/barato)",
  "claude-sonnet-4-6":         "Sonnet 4.6",
  "claude-opus-4-7":           "Opus 4.7",
  "llama-3.3-70b-versatile":   "Llama 3.3 70B",
  "llama-3.1-8b-instant":      "Llama 3.1 8B",
  "gemma2-9b-it":              "Gemma 2 9B",
  "meta-llama/llama-3.3-70b-instruct:free": "Llama 3.3 70B (free)",
  "google/gemma-3-27b-it:free":             "Gemma 3 27B (free)",
  "mistralai/mistral-7b-instruct:free":     "Mistral 7B (free)",
  "gemini-2.0-flash": "Gemini 2.0 Flash",
  "gemini-1.5-flash": "Gemini 1.5 Flash",
  "gemini-1.5-pro":   "Gemini 1.5 Pro",
};

const providerSel = document.getElementById("provider");
const modelSel    = document.getElementById("model");
const apiKeyInput = document.getElementById("apiKey");
const saveBtn     = document.getElementById("save");
const notice      = document.getElementById("notice");

function populateModels(provider, selectedModel) {
  const list = MODELS[provider] || [];
  modelSel.innerHTML = list
    .map((m) => `<option value="${m}" ${m === selectedModel ? "selected" : ""}>${MODEL_LABELS[m] || m}</option>`)
    .join("");
}

providerSel.addEventListener("change", () => {
  populateModels(providerSel.value, MODELS[providerSel.value]?.[0]);
});

// Load saved settings
chrome.storage.sync.get(["provider", "model", "apiKey"], (s) => {
  const provider = s.provider || "openai";
  providerSel.value = provider;
  populateModels(provider, s.model);
  if (s.apiKey) apiKeyInput.value = s.apiKey;
});

saveBtn.addEventListener("click", async () => {
  const provider = providerSel.value;
  const model    = modelSel.value;
  const apiKey   = apiKeyInput.value.trim();

  if (!apiKey) {
    showNotice("Insira sua chave de API antes de salvar.", "error");
    return;
  }

  await chrome.storage.sync.set({ provider, model, apiKey });
  showNotice("Configurações salvas! Recarregue a aba para ativar.", "ok");
});

function showNotice(msg, type) {
  notice.className = `notice ${type}`;
  notice.textContent = msg;
  notice.style.display = "block";
  if (type === "ok") setTimeout(() => { notice.style.display = "none"; }, 3000);
}
