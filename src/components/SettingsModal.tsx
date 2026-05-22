import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Button, Label, Checkbox, CheckboxControl, CheckboxIndicator, CheckboxContent,
  Select, SelectTrigger, SelectValue, SelectIndicator, SelectPopover,
  ListBox, ListBoxItem, Tabs,
} from "@heroui/react";
import { ArrowLeft, ExternalLink, BadgeCheck, Eye, EyeOff, Sun, Moon, MessageSquareWarning, RefreshCw, Check, Loader2, Download } from "lucide-react";
import { AppSettings } from "../types";
import { PROVIDER_MODELS, MODEL_LABELS } from "../services/ai.service";
import { checkForUpdate, downloadAndInstall, CURRENT_VERSION, UpdateStatus } from "../services/checkupdate.service";
import logoFull from "../assets/logo_full.png";
import logoRpcDark from "../assets/logo.png";
import logoRpcLight from "../assets/logo_default.png";

interface Props {
  settings: AppSettings;
  onSave: (s: AppSettings) => void;
  onBack: () => void;
}

type ChromeExtensionDownloadInfo = {
  path: string;
  fileName: string;
};

const inputCls = [
  "w-full px-3 py-2 text-sm rounded-xl outline-none transition-colors font-sans",
  "border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]",
  "focus:border-[var(--accent)]",
].join(" ");

const PROVIDER_INFO: Record<string, {
  name: string;
  description: string;
  free: boolean;
  apiKeyUrl: string;
  keyHint: string;
}> = {
  openai: {
    name: "OpenAI",
    description: "Criadora do ChatGPT. Os modelos GPT são referência em geração de texto — alta qualidade, ampla adoção. Requer cartão de crédito.",
    free: false,
    apiKeyUrl: "https://platform.openai.com/api-keys",
    keyHint: "Crie uma conta em platform.openai.com",
  },
  claude: {
    name: "Anthropic (Claude)",
    description: "IA da Anthropic, projetada com foco em segurança e precisão. Excelente para escrita, revisão e análise detalhada.",
    free: false,
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
    keyHint: "Crie uma conta em console.anthropic.com",
  },
  groq: {
    name: "Groq",
    description: "Infraestrutura de inferência ultra-rápida com modelos open-source como Llama e Gemma. Plano gratuito com limite generoso — ideal para uso diário.",
    free: true,
    apiKeyUrl: "https://console.groq.com/keys",
    keyHint: "Crie uma conta grátis em console.groq.com",
  },
  openrouter: {
    name: "OpenRouter",
    description: "Hub que reúne dezenas de modelos de diferentes provedores (OpenAI, Anthropic, Meta, Google e outros) em uma única API. Vários modelos são completamente gratuitos — ótima porta de entrada sem custo.",
    free: true,
    apiKeyUrl: "https://openrouter.ai/settings/keys",
    keyHint: "Crie uma conta grátis em openrouter.ai",
  },
  gemini: {
    name: "Google Gemini",
    description: "Modelos Gemini do Google, acessados via Google AI Studio. Plano gratuito muito generoso — sem necessidade de cartão de crédito.",
    free: true,
    apiKeyUrl: "https://aistudio.google.com/app/apikey",
    keyHint: "Gere sua chave grátis em aistudio.google.com",
  },
};

const API_KEY_PLACEHOLDER: Record<string, string> = {
  openai:     "sk-...",
  claude:     "sk-ant-...",
  groq:       "gsk_...",
  openrouter: "sk-or-...",
  gemini:     "AIza...",
};

async function openLink(url: string) {
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch {
    window.open(url, "_blank", "noopener");
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs font-medium" style={{ color: "var(--foreground)" }}>{label}</Label>
      {children}
    </div>
  );
}

export function SettingsPage({ settings, onSave, onBack }: Props) {
  const [form, setForm] = useState<AppSettings>({ ...settings });
  const [showKey, setShowKey] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [downloadPct, setDownloadPct] = useState<number | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [pluginPath, setPluginPath] = useState<string | null>(null);
  const [pluginStatus, setPluginStatus] = useState<"idle" | "downloading" | "ready" | "error">("idle");
  const [pluginError, setPluginError] = useState<string | null>(null);

  async function checkUpdate() {
    setUpdateStatus("checking");
    setUpdateError(null);
    const result = await checkForUpdate();
    setUpdateStatus(result.status);
    setLatestVersion(result.version ?? null);
    if (result.errorMessage) setUpdateError(result.errorMessage);
  }

  async function handleInstall() {
    setUpdateStatus("downloading");
    setDownloadPct(null);
    try {
      await downloadAndInstall((pct) => {
        if (pct === 100) setUpdateStatus("installing");
        else setDownloadPct(pct);
      });
    } catch (e: unknown) {
      setUpdateStatus("error");
      setUpdateError(e instanceof Error ? e.message : "Falha ao instalar.");
    }
  }

  async function downloadPlugin() {
    setPluginStatus("downloading");
    setPluginError(null);
    try {
      const info = await invoke<ChromeExtensionDownloadInfo>("download_chrome_extension");
      setPluginPath(info.path);
      setPluginStatus("ready");
    } catch (e: unknown) {
      setPluginStatus("error");
      setPluginError(e instanceof Error ? e.message : "Falha ao baixar o plugin.");
    }
  }

  const models = PROVIDER_MODELS[form.apiProvider] ?? [];
  const info = PROVIDER_INFO[form.apiProvider];

  function set<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    if (key === "apiProvider") setShowKey(false);
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "apiProvider") {
        next.model = PROVIDER_MODELS[value as string]?.[0] ?? "";
      }
      return next;
    });
  }

  return (
    <div className="flex flex-col h-full settings-page-enter" style={{ background: "var(--background)" }}>

      {/* Header */}
      <header
        className="flex items-center gap-2 px-3 py-3 shrink-0"
        style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}
      >
        <Button size="sm" variant="ghost" isIconOnly aria-label="Voltar" onPress={onBack}>
          <ArrowLeft size={16} />
        </Button>
        <span className="font-semibold text-sm" style={{ color: "var(--foreground)" }}>Configurações</span>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <Tabs defaultSelectedKey="ia">
          <Tabs.ListContainer>
            <Tabs.List aria-label="Seções de configuração">
              <Tabs.Tab id="ia">Inteligência Artificial<Tabs.Indicator /></Tabs.Tab>
              <Tabs.Tab id="prefs">Preferências<Tabs.Indicator /></Tabs.Tab>
              <Tabs.Tab id="sobre">Sobre<Tabs.Indicator /></Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>

          {/* ── IA Tab ─────────────────────────────────────────────────────── */}
          <Tabs.Panel id="ia" className="flex flex-col gap-4 pt-4">

            <Field label="Provedor">
              <Select
                selectedKey={form.apiProvider}
                onSelectionChange={(key) => set("apiProvider", key as AppSettings["apiProvider"])}
              >
                <SelectTrigger><SelectValue /><SelectIndicator /></SelectTrigger>
                <SelectPopover>
                  <ListBox>
                    <ListBoxItem id="openai">OpenAI</ListBoxItem>
                    <ListBoxItem id="claude">Anthropic (Claude)</ListBoxItem>
                    <ListBoxItem id="groq">Groq</ListBoxItem>
                    <ListBoxItem id="openrouter">OpenRouter</ListBoxItem>
                    <ListBoxItem id="gemini">Google Gemini</ListBoxItem>
                  </ListBox>
                </SelectPopover>
              </Select>
            </Field>

            {/* Contextual provider info card */}
            {info && (
              <div
                className="rounded-2xl p-3.5 flex flex-col gap-2.5"
                style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold" style={{ color: "var(--foreground)" }}>
                    {info.name}
                  </span>
                  {info.free && (
                    <span
                      className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                      style={{ background: "color-mix(in oklab, var(--success) 15%, transparent)", color: "var(--success)" }}
                    >
                      <BadgeCheck size={11} /> Gratuito
                    </span>
                  )}
                </div>
                <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                  {info.description}
                </p>
                <div className="h-px" style={{ background: "var(--border)" }} />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px]" style={{ color: "var(--muted)" }}>
                    {info.keyHint}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onPress={() => openLink(info.apiKeyUrl)}
                    className="text-xs shrink-0 h-7 px-2.5"
                  >
                    <ExternalLink size={11} /> Obter chave
                  </Button>
                </div>
              </div>
            )}

            <Field label="Chave da API">
              <div className="relative">
                <input
                  type={showKey ? "text" : "password"}
                  className={inputCls + " pr-9"}
                  placeholder={API_KEY_PLACEHOLDER[form.apiProvider] ?? "chave..."}
                  value={form.apiKeys[form.apiProvider] ?? ""}
                  onChange={(e) =>
                    set("apiKeys", { ...form.apiKeys, [form.apiProvider]: e.target.value })
                  }
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  aria-label={showKey ? "Ocultar chave" : "Mostrar chave"}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 transition-colors"
                  style={{ color: "var(--muted)" }}
                >
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </Field>

            <Field label="Modelo">
              <Select
                selectedKey={form.model}
                onSelectionChange={(key) => set("model", String(key))}
              >
                <SelectTrigger><SelectValue /><SelectIndicator /></SelectTrigger>
                <SelectPopover>
                  <ListBox>
                    {models.map((m) => (
                      <ListBoxItem key={m} id={m}>{MODEL_LABELS[m] ?? m}</ListBoxItem>
                    ))}
                  </ListBox>
                </SelectPopover>
              </Select>
            </Field>

          </Tabs.Panel>

          {/* ── Preferências Tab ───────────────────────────────────────────── */}
          <Tabs.Panel id="prefs" className="flex flex-col gap-4 pt-4">

            <Field label="Tema">
              <div className="flex gap-2">
                {(["light", "dark"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => set("theme", t)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 text-sm rounded-xl border transition-colors cursor-pointer"
                    style={{
                      borderColor: form.theme === t ? "var(--accent)" : "var(--border)",
                      background:  form.theme === t ? "var(--accent)" : "var(--surface)",
                      color:       form.theme === t ? "#fff" : "var(--foreground)",
                    }}
                  >
                    {t === "light" ? <><Sun size={13} /> Claro</> : <><Moon size={13} /> Escuro</>}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Modo de exibição">
              <div className="flex gap-2">
                {(["popup", "window"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => set("windowMode", m)}
                    className="flex-1 py-2 px-3 text-sm rounded-xl border transition-colors cursor-pointer"
                    style={{
                      borderColor: form.windowMode === m ? "var(--accent)" : "var(--border)",
                      background:  form.windowMode === m ? "var(--accent)" : "var(--surface)",
                      color:       form.windowMode === m ? "#fff" : "var(--foreground)",
                    }}
                  >
                    {m === "popup" ? "Popup (menu bar)" : "Janela"}
                  </button>
                ))}
              </div>
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                {form.windowMode === "popup"
                  ? "Abre abaixo do ícone na barra de menu, fecha ao perder foco."
                  : "Abre como janela normal, pode redimensionar."}
              </p>
            </Field>

            <Field label="Limite de caracteres">
              <div className="flex flex-col gap-1">
                <input
                  type="number"
                  className={inputCls}
                  min={500}
                  max={32000}
                  value={form.maxTextLength}
                  onChange={(e) => set("maxTextLength", Number(e.target.value))}
                />
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  Textos maiores que esse limite serão rejeitados (500–32 000).
                </p>
              </div>
            </Field>

            <Checkbox
              isSelected={form.saveHistory}
              onChange={(checked) => set("saveHistory", checked)}
            >
              <CheckboxControl><CheckboxIndicator /></CheckboxControl>
              <CheckboxContent>Salvar histórico local</CheckboxContent>
            </Checkbox>

            <Checkbox
              isSelected={form.toolbarEnabled ?? true}
              onChange={(checked) => set("toolbarEnabled", checked)}
            >
              <CheckboxControl><CheckboxIndicator /></CheckboxControl>
              <CheckboxContent>
                <span>Toolbar flutuante</span>
                <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                  Exibe botões de ação ao focar em campos de texto de outros apps
                </p>
              </CheckboxContent>
            </Checkbox>

          </Tabs.Panel>

          {/* ── Sobre Tab ──────────────────────────────────────────────────── */}
          <Tabs.Panel id="sobre" className="flex flex-col gap-4 pt-4">

            <div className="flex flex-col items-center gap-3 py-2">
              <img src={logoFull} alt="Melhora.AI" draggable="false" className="h-9 w-auto select-none" />
              <span className="text-xs font-medium" style={{ color: "var(--muted)" }}>
                Versão {CURRENT_VERSION}
              </span>
            </div>

            <p className="text-xs text-center leading-relaxed px-2" style={{ color: "var(--muted)" }}>
              Assistente de escrita com IA integrado ao seu clipboard.
              Seus textos nunca passam pelos nossos servidores — a chamada vai
              direto do seu dispositivo para o provedor que você configurar.
            </p>

            <div className="h-px" style={{ background: "var(--border)" }} />

            {/* Update checker */}
            <div
              className="rounded-xl px-3 py-2.5 flex flex-col gap-2"
              style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs" style={{ color: "var(--muted)" }}>
                  Versão instalada: <span className="font-semibold" style={{ color: "var(--foreground)" }}>{CURRENT_VERSION}</span>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  isDisabled={["checking", "downloading", "installing"].includes(updateStatus)}
                  onPress={checkUpdate}
                  className="h-7 px-2.5 text-xs shrink-0"
                >
                  {updateStatus === "checking"
                    ? <><Loader2 size={11} className="animate-spin" /> Verificando...</>
                    : <><RefreshCw size={11} /> Verificar</>}
                </Button>
              </div>

              {updateStatus === "up_to_date" && (
                <span className="text-xs flex items-center gap-1.5" style={{ color: "var(--success, #22c55e)" }}>
                  <Check size={12} /> Você está na versão mais recente
                </span>
              )}
              {updateStatus === "available" && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs" style={{ color: "var(--warning, #f59e0b)" }}>
                    Nova versão: <strong>v{latestVersion}</strong>
                  </span>
                  <Button size="sm" variant="primary" onPress={handleInstall} className="h-7 px-2.5 text-xs shrink-0">
                    <ExternalLink size={11} /> Baixar e instalar
                  </Button>
                </div>
              )}
              {updateStatus === "downloading" && (
                <div className="flex items-center gap-2">
                  <Loader2 size={12} className="animate-spin shrink-0" style={{ color: "var(--accent)" }} />
                  <span className="text-xs" style={{ color: "var(--muted)" }}>
                    {downloadPct !== null ? `Baixando... ${downloadPct}%` : "Baixando..."}
                  </span>
                </div>
              )}
              {updateStatus === "installing" && (
                <div className="flex items-center gap-2">
                  <Loader2 size={12} className="animate-spin shrink-0" style={{ color: "var(--accent)" }} />
                  <span className="text-xs" style={{ color: "var(--muted)" }}>
                    Instalando... O app será reiniciado.
                  </span>
                </div>
              )}
              {updateStatus === "error" && (
                <span className="text-xs" style={{ color: "var(--danger, #ef4444)" }}>
                  {updateError ?? "Não foi possível verificar atualizações."}
                </span>
              )}
            </div>

            {/* Chrome extension */}
            <div
              className="rounded-xl px-3 py-2.5 flex flex-col gap-2"
              style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold" style={{ color: "var(--foreground)" }}>
                  Extensão do Chrome
                </span>
                <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--muted)" }}>
                  Manual
                </span>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                Baixe o arquivo da extensão, extraia o zip e carregue a pasta no Chrome em modo de desenvolvedor.
              </p>
              <div className="grid grid-cols-1 gap-2">
                <Button
                  variant="outline"
                  fullWidth
                  isDisabled={pluginStatus === "downloading"}
                  onPress={downloadPlugin}
                  className="text-sm justify-start"
                >
                  {pluginStatus === "downloading"
                    ? <><Loader2 size={14} className="animate-spin" /> Gerando...</>
                    : <><Download size={14} /> Baixar plugin</>}
                </Button>
              </div>
              {pluginPath && (
                <span className="text-[11px] leading-relaxed break-all" style={{ color: "var(--muted)" }}>
                  Salvo em {pluginPath}
                </span>
              )}
              {pluginStatus === "error" && (
                <span className="text-xs" style={{ color: "var(--danger, #ef4444)" }}>
                  {pluginError ?? "Não foi possível baixar o plugin."}
                </span>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Button
                variant="outline"
                fullWidth
                onPress={() => openLink("https://github.com/douglasscriptore/melhora_ai/issues")}
                className="text-sm justify-start"
              >
                <MessageSquareWarning size={14} /> Relatar um problema
              </Button>
            </div>

            <div className="flex flex-col items-center gap-0.5">
              <span className="text-[11px]" style={{ color: "var(--muted)" }}>
                Desenvolvido por <span className="font-semibold" style={{ color: "var(--foreground)" }}>Douglas Scriptore</span>
              </span>
              <div className="flex items-center gap-1.5 mt-1.5">
                <span className="text-[9px] uppercase tracking-widest" style={{ color: "var(--muted)" }}>Tecnologia</span>
                <img
                  src={form.theme === "dark" ? logoRpcDark : logoRpcLight}
                  alt="RPC"
                  draggable="false"
                  className="h-3.5 w-auto select-none"
                />
              </div>
            </div>

          </Tabs.Panel>
        </Tabs>
      </div>

      {/* Footer */}
      <footer
        className="shrink-0 flex gap-2 justify-end px-4 py-3"
        style={{ borderTop: "1px solid var(--border)", background: "var(--surface)" }}
      >
        <Button variant="outline" onPress={onBack}>Cancelar</Button>
        <Button variant="primary" onPress={() => onSave(form)}>Salvar</Button>
      </footer>

    </div>
  );
}
