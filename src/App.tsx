import { useState, useEffect, useCallback, useRef, Component } from "react";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { Button, Alert, Tooltip } from "@heroui/react";
import { History, Settings, Clipboard, Copy, Check, Loader2, ArrowRight, Sun, Moon, RefreshCw } from "lucide-react";
import { Toast, toast } from "@heroui/react";
import { AIMode, HistoryEntry } from "./types";
import { processText, PROVIDER_NAMES } from "./services/ai.service";
import { addHistory } from "./services/history.service";
import { useSettings } from "./hooks/useSettings";
import { ModeSelector } from "./components/ModeSelector";
import { SettingsPage } from "./components/SettingsModal";
import { HistoryDrawer } from "./components/HistoryPanel";
import logoFull from "./assets/logo_full.png";
import logoRpcDark from "./assets/logo.png";
import logoRpcLight from "./assets/logo_default.png";
import "./App.css";

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const isWindows = typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);

class SettingsBoundary extends Component<{ children: React.ReactNode }, { err: string | null }> {
  state = { err: null };
  static getDerivedStateFromError(e: Error) { return { err: e.message + "\n\n" + (e.stack ?? "") }; }
  render() {
    if (this.state.err) return (
      <div style={{ padding: 16, overflow: "auto", height: "100%", background: "#1a1a1a", color: "#ff6b6b", fontSize: 11, whiteSpace: "pre-wrap", fontFamily: "monospace" }}>
        {"ERRO nas Configurações:\n\n" + this.state.err}
      </div>
    );
    return this.props.children;
  }
}

export default function App() {
  const { settings, loading, updateSettings } = useSettings();
  const rootRef = useRef<HTMLDivElement>(null);
  const [inputText, setInputText] = useState("");
  const [resultText, setResultText] = useState("");
  const [mode, setMode] = useState<AIMode>("corrigir_portugues");
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedGCLine, setCopiedGCLine] = useState<number | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [resultMeta, setResultMeta] = useState<{ inputTokens?: number; outputTokens?: number; estimatedCostUSD?: number } | null>(null);
  const [axPermission, setAxPermission] = useState<boolean | null>(null);

  const readClipboard = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const text = await readText();
      if (text) setInputText(text);
    } catch { /* empty or non-text */ }
  }, []);

  useEffect(() => { readClipboard(); }, [readClipboard]);

  useEffect(() => {
    if (!isTauri()) return;
    invoke<boolean>("check_ax_permission").then(setAxPermission).catch(() => setAxPermission(false));
  }, []);

  // Restore last used mode once settings load
  useEffect(() => {
    if (settings?.lastMode) setMode(settings.lastMode);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!settings]);

  // Apply window mode to Rust backend + DOM when settings load
  useEffect(() => {
    if (!settings || loading) return;
    const mode = settings.windowMode ?? "popup";
    if (mode === "popup") {
      document.documentElement.classList.add("popup-mode");
    } else {
      document.documentElement.classList.remove("popup-mode");
    }
    if (isTauri()) invoke("apply_window_mode", { mode }).catch(() => {});
  }, [settings?.windowMode, loading]);

  // Clip native macOS window frame to rounded corners
  useEffect(() => {
    if (!isTauri()) return;
    const s = document.createElement("style");
    s.textContent = "html,body{background:transparent!important;}";
    document.head.appendChild(s);
    invoke("set_corner_radius", { radius: 14.0 }).catch(() => {});
  }, []);

  // Sync toolbar enabled state with Rust backend
  useEffect(() => {
    if (!settings || loading || !isTauri()) return;
    invoke("set_toolbar_enabled", { enabled: settings.toolbarEnabled ?? true }).catch(() => {});
  }, [settings?.toolbarEnabled, loading]);

  // Apply theme to html element
  useEffect(() => {
    if (!settings || loading) return;
    document.documentElement.setAttribute("data-theme", settings.theme ?? "light");
  }, [settings?.theme, loading]);


  // Entrance animation on window focus (popup mode only)
  useEffect(() => {
    if (!isTauri()) return;
    const triggerAnim = () => {
      const el = rootRef.current;
      if (!el) return;
      el.classList.remove("app-enter");
      void el.offsetWidth;
      el.classList.add("app-enter");
    };
    triggerAnim();
    let unlisten: (() => void) | undefined;
    getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) triggerAnim();
    }).then((fn) => { unlisten = fn; }).catch(() => {});
    return () => { unlisten?.(); };
  }, []);

  async function handleProcess() {
    if (!inputText.trim() || !settings) return;
    setIsProcessing(true);
    setError(null);
    setResultText("");
    setResultMeta(null);
    try {
      const result = await processText(inputText, mode, settings, (chunk) => {
        setResultText((prev) => prev + chunk);
      });
      setResultMeta({ inputTokens: result.inputTokens, outputTokens: result.outputTokens, estimatedCostUSD: result.estimatedCostUSD });
      if (settings.saveHistory) await addHistory(inputText, result.text, mode).catch(() => {});
      // Auto-copy result
      if (isTauri()) await writeText(result.text).catch(() => {});
      else await navigator.clipboard.writeText(result.text).catch(() => {});
      toast.success("Copiado!", { description: "Resultado na área de transferência." });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsProcessing(false);
    }
  }

  function handleModeChange(m: AIMode) {
    setMode(m);
    if (settings) updateSettings({ ...settings, lastMode: m });
  }

  async function copyGCLine(line: string, index: number) {
    if (isTauri()) await writeText(line);
    else await navigator.clipboard.writeText(line);
    setCopiedGCLine(index);
    setTimeout(() => setCopiedGCLine(null), 3000);
    toast.success("Copiado!", { description: "Linha copiada para a área de transferência." });
  }

  async function handleCopy() {
    if (!resultText) return;
    if (isTauri()) await writeText(resultText);
    else await navigator.clipboard.writeText(resultText);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
    toast.success("Copiado!", { description: "Resultado copiado para a área de transferência." });
  }

  async function handleReplaceAndClose() {
    if (!resultText) return;
    if (isTauri()) await writeText(resultText);
    else await navigator.clipboard.writeText(resultText);
    if (isTauri()) setTimeout(() => getCurrentWindow().hide(), 300);
  }

  function handleHistorySelect(entry: HistoryEntry) {
    setInputText(entry.original_text);
    setResultText(entry.result_text);
    setMode(entry.mode);
    setShowHistory(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-sm" style={{ color: "var(--muted)" }}>
        Carregando...
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className="app-root flex flex-col h-screen"
      style={{ background: "var(--background)", color: "var(--foreground)" }}
    >
      <Toast.Provider placement="top" />

      {showSettings && settings ? (
        <SettingsBoundary>
          <SettingsPage
            settings={settings}
            onSave={async (s) => {
              await updateSettings(s);
              if (isTauri()) invoke("apply_window_mode", { mode: s.windowMode ?? "popup" }).catch(() => {});
              setShowSettings(false);
            }}
            onBack={() => setShowSettings(false)}
          />
        </SettingsBoundary>
      ) : (
      <>

      {/* Header */}
      <header
        data-tauri-drag-region
        className="flex items-center justify-between px-4 py-3 gap-2"
        style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}
      >
        {/* macOS — close + minimize on the left */}
        {settings?.windowMode === "window" && !isWindows && (
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={() => isTauri() && getCurrentWindow().hide()}     aria-label="Fechar"    className="window-btn window-btn-close" />
            <button onClick={() => isTauri() && getCurrentWindow().minimize()} aria-label="Minimizar" className="window-btn window-btn-minimize" />
          </div>
        )}

        {settings?.windowMode === "window"
          ? <img src={logoFull} alt="Melhora.AI" draggable="false" className="h-7 w-auto flex-1 object-left object-contain select-none" />
          : <span className="font-semibold text-[15px] flex-1 select-none" style={{ color: "var(--accent)" }}>Melhora.AI</span>
        }
        <div className="flex items-center gap-1 shrink-0">
          <Tooltip>
            <Button
              size="sm" variant="ghost" isIconOnly
              aria-label="Alternar tema"
              onPress={() => {
                const next = (settings?.theme ?? "light") === "light" ? "dark" : "light";
                updateSettings({ ...settings!, theme: next });
              }}
            >
              {settings?.theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </Button>
            <Tooltip.Content><p>{settings?.theme === "dark" ? "Tema claro" : "Tema escuro"}</p></Tooltip.Content>
          </Tooltip>
          <Tooltip>
            <Button size="sm" variant="ghost" isIconOnly aria-label="Histórico" onPress={() => setShowHistory(true)}>
              <History size={16} />
            </Button>
            <Tooltip.Content><p>Histórico</p></Tooltip.Content>
          </Tooltip>
          <Tooltip>
            <Button size="sm" variant="ghost" isIconOnly aria-label="Configurações" onPress={() => setShowSettings(true)}>
              <Settings size={16} />
            </Button>
            <Tooltip.Content><p>Configurações</p></Tooltip.Content>
          </Tooltip>

          {/* Windows — minimize + close on the right */}
          {settings?.windowMode === "window" && isWindows && (
            <>
              <button onClick={() => isTauri() && getCurrentWindow().minimize()} aria-label="Minimizar" className="window-btn window-btn-minimize" />
              <button onClick={() => isTauri() && getCurrentWindow().hide()}     aria-label="Fechar"    className="window-btn window-btn-close" />
            </>
          )}
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">

        {/* Input section */}
        <div className="flex flex-col gap-1">
          <div className="flex justify-between items-center">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
              Texto original
            </span>
            <Button size="sm" variant="ghost" onPress={readClipboard} className="text-xs h-6 px-2">
              <Clipboard size={13} /> Colar clipboard
            </Button>
          </div>
          <textarea
            className={`field-textarea${isProcessing ? " ai-loading" : ""}`}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Cole ou escreva o texto aqui..."
            rows={5}
          />
          <span className="text-xs text-right" style={{ color: "var(--muted)" }}>
            {inputText.length} caracteres
          </span>
        </div>

        {/* Mode selector */}
        <ModeSelector selected={mode} onChange={handleModeChange} disabled={isProcessing} />

        {/* Process button */}
        <Button
          variant="primary"
          fullWidth
          onPress={handleProcess}
          isDisabled={isProcessing || !inputText.trim() || !settings?.apiKeys?.[settings.apiProvider]}
          className="h-10 shrink-0"
        >
          {isProcessing
            ? <><Loader2 size={15} className="animate-spin" /> Processando...</>
            : <>Processar com IA <ArrowRight size={15} /></>
          }
        </Button>

        {/* Error */}
        {error && (
          <Alert status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>{error}</Alert.Description>
            </Alert.Content>
          </Alert>
        )}

        {/* Accessibility permission alert */}
        {axPermission === false && (
          <Alert status="warning">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>
                <strong>Toolbar de inputs desativada.</strong> Conceda acesso de Acessibilidade para detectar campos de texto em outros apps.{" "}
                <span
                  role="button"
                  tabIndex={0}
                  className="underline font-semibold cursor-pointer"
                  onClick={async () => {
                    await invoke("request_ax_permission");
                    setAxPermission(await invoke<boolean>("check_ax_permission"));
                  }}
                  onKeyDown={async (e) => {
                    if (e.key !== "Enter") return;
                    await invoke("request_ax_permission");
                    setAxPermission(await invoke<boolean>("check_ax_permission"));
                  }}
                >
                  Conceder acesso
                </span>
              </Alert.Description>
            </Alert.Content>
          </Alert>
        )}

        {/* Onboarding / privacy notice */}
        {!settings?.apiKeys?.[settings.apiProvider] ? (
          <Alert status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>
                Chave de API não configurada.{" "}
                <span
                  role="button"
                  tabIndex={0}
                  className="underline font-semibold cursor-pointer"
                  onClick={() => setShowSettings(true)}
                  onKeyDown={(e) => e.key === "Enter" && setShowSettings(true)}
                >
                  Abrir Configurações
                </span>
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : !resultText && !error ? (
          <Alert status="warning">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>
                Seus textos são enviados para a API da{" "}
                <strong>{PROVIDER_NAMES[settings.apiProvider] ?? settings.apiProvider}</strong>.
                {" "}Não inclua senhas, dados pessoais ou informações confidenciais.
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}

        {/* Result section */}
        {resultText && mode === "gerar_gc" ? (() => {
          const [gcLine1 = "", gcLine2 = ""] = resultText.split("\n").filter((l) => l.trim());
          const gcLines = [gcLine1, gcLine2];
          const limits = [61, 79];
          const labels = ["Título", "Subtítulo"];
          return (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                Resultado GC
              </span>
              {gcLines.map((line, i) => (
                <div
                  key={i}
                  className="rounded-xl px-3 py-2.5 flex flex-col gap-1.5"
                  role="button"
                  tabIndex={0}
                  aria-label={`Copiar linha ${i + 1}`}
                  onClick={() => copyGCLine(line, i)}
                  onKeyDown={(e) => e.key === "Enter" && copyGCLine(line, i)}
                  style={{
                    background: "var(--surface)",
                    border: `1px solid ${copiedGCLine === i ? "var(--success)" : line.length > limits[i] ? "var(--danger, #ef4444)" : "var(--border)"}`,
                    cursor: "pointer",
                    transition: "border-color 600ms ease",
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted)", transition: "color 600ms ease" }}>
                      {copiedGCLine === i ? "Copiado!" : `Linha ${i + 1} — ${labels[i]}`}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span
                        className="text-[10px] font-mono tabular-nums"
                        style={{ color: line.length > limits[i] ? "var(--danger, #ef4444)" : "var(--muted)" }}
                      >
                        {line.length}/{limits[i]}
                      </span>
                      {copiedGCLine === i
                        ? <Check size={13} style={{ color: "var(--success)" }} />
                        : <Copy size={13} style={{ color: "var(--muted)" }} />}
                    </div>
                  </div>
                  <p
                    className="text-sm font-mono break-all leading-snug"
                    style={{ color: "var(--foreground)" }}
                  >
                    {line || <span style={{ color: "var(--muted)" }}>—</span>}
                  </p>
                </div>
              ))}
              {resultMeta && (resultMeta.inputTokens !== undefined || resultMeta.estimatedCostUSD !== undefined) && (
                <span className="text-xs" style={{ color: "var(--muted)" }}>
                  {resultMeta.inputTokens !== undefined && `${resultMeta.inputTokens} + ${resultMeta.outputTokens ?? 0} tokens`}
                  {resultMeta.estimatedCostUSD !== undefined && resultMeta.estimatedCostUSD > 0 && (
                    <> &mdash; ~${resultMeta.estimatedCostUSD.toFixed(5)}</>
                  )}
                </span>
              )}
              <div className="flex justify-end gap-2 mt-1">
                <Button variant="ghost" size="sm" onPress={handleProcess} isDisabled={isProcessing}>
                  <RefreshCw size={13} /> Outra versão
                </Button>
                <Button variant="primary" size="sm" onPress={handleReplaceAndClose}>
                  <Clipboard size={13} /> Copiar tudo e fechar
                </Button>
              </div>
            </div>
          );
        })() : resultText ? (
          <div className="flex flex-col gap-2">
            <div
              className="rounded-xl px-3 py-2.5 flex flex-col gap-2"
              role="button"
              tabIndex={0}
              aria-label="Copiar resultado"
              onClick={handleCopy}
              onKeyDown={(e) => e.key === "Enter" && handleCopy()}
              style={{
                background: "var(--surface)",
                border: `1px solid ${copied ? "var(--success)" : "var(--border)"}`,
                cursor: "pointer",
                transition: "border-color 600ms ease",
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted)", transition: "color 600ms ease" }}>
                  {copied ? "Copiado!" : "Resultado — clique para copiar"}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-mono tabular-nums" style={{ color: "var(--muted)" }}>
                    {resultText.length} caracteres
                  </span>
                  {copied ? <Check size={13} style={{ color: "var(--success)" }} /> : <Copy size={13} style={{ color: "var(--muted)" }} />}
                </div>
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap break-words" style={{ color: "var(--foreground)" }}>
                {resultText}
              </p>
            </div>
            {resultMeta && (resultMeta.inputTokens !== undefined || resultMeta.estimatedCostUSD !== undefined) && (
              <span className="text-xs" style={{ color: "var(--muted)" }}>
                {resultMeta.inputTokens !== undefined && `${resultMeta.inputTokens} + ${resultMeta.outputTokens ?? 0} tokens`}
                {resultMeta.estimatedCostUSD !== undefined && resultMeta.estimatedCostUSD > 0 && (
                  <> &mdash; ~${resultMeta.estimatedCostUSD.toFixed(5)}</>
                )}
              </span>
            )}
            <div className="flex justify-end gap-2 mt-1">
              <Button variant="ghost" size="sm" onPress={handleProcess} isDisabled={isProcessing}>
                <RefreshCw size={13} /> Outra versão
              </Button>
              <Button variant="primary" size="sm" onPress={handleReplaceAndClose}>
                <Clipboard size={13} /> Copiar e fechar
              </Button>
            </div>
          </div>
        ) : null}
      </main>

      {/* Powered by footer */}
      <footer
        className="shrink-0 flex items-center justify-center gap-1.5 py-1.5"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        <span className="text-[9px] uppercase tracking-widest" style={{ color: "var(--muted)" }}>Powered by</span>
        <img
          src={settings?.theme === "dark" ? logoRpcDark : logoRpcLight}
          alt="RPC"
          draggable="false"
          className="h-3.5 w-auto select-none"
        />
      </footer>

      {showHistory && (
        <HistoryDrawer
          onSelect={handleHistorySelect}
          onClose={() => setShowHistory(false)}
        />
      )}

      </>
      )}
    </div>
  );
}
