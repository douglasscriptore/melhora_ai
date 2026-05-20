import { useState, useEffect, useCallback, useRef } from "react";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { Button, Alert, Tooltip } from "@heroui/react";
import { History, Settings, Clipboard, Copy, Check, Loader2, ArrowRight, Sun, Moon } from "lucide-react";
import { AIMode, HistoryEntry } from "./types";
import { processText } from "./services/ai.service";
import { addHistory } from "./services/history.service";
import { useSettings } from "./hooks/useSettings";
import { ModeSelector } from "./components/ModeSelector";
import { SettingsDrawer } from "./components/SettingsModal";
import { HistoryDrawer } from "./components/HistoryPanel";
import logoFull from "./assets/logo_full.png";
import "./App.css";

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const isWindows = typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);

export default function App() {
  const { settings, loading, updateSettings } = useSettings();
  const rootRef = useRef<HTMLDivElement>(null);
  const [inputText, setInputText] = useState("");
  const [resultText, setResultText] = useState("");
  const [mode, setMode] = useState<AIMode>("corrigir_portugues");
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const readClipboard = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const text = await readText();
      if (text) setInputText(text);
    } catch { /* empty or non-text */ }
  }, []);

  useEffect(() => { readClipboard(); }, [readClipboard]);

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
    try {
      const result = await processText(inputText, mode, settings);
      setResultText(result.text);
      if (settings.saveHistory) await addHistory(inputText, result.text, mode).catch(() => {});
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleCopy() {
    if (!resultText) return;
    if (isTauri()) await writeText(resultText);
    else await navigator.clipboard.writeText(resultText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
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
        <ModeSelector selected={mode} onChange={setMode} disabled={isProcessing} />

        {/* Process button */}
        <Button
          variant="primary"
          fullWidth
          onPress={handleProcess}
          isDisabled={isProcessing || !inputText.trim() || !settings?.apiKey}
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

        {/* Onboarding / privacy notice */}
        {!settings?.apiKey ? (
          <Alert status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>
                Chave de API não configurada.{" "}
                <button
                  className="underline font-semibold cursor-pointer"
                  style={{ color: "inherit" }}
                  onClick={() => setShowSettings(true)}
                >
                  Abrir Configurações
                </button>
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : !resultText && !error ? (
          <Alert status="warning">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>
                Seus textos são enviados para a API da{" "}
                <strong>{settings.apiProvider === "claude" ? "Anthropic" : "OpenAI"}</strong>.
                {" "}Não inclua senhas, dados pessoais ou informações confidenciais.
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}

        {/* Result section */}
        {resultText && (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
              Resultado
            </span>
            <textarea
              className="field-textarea result"
              value={resultText}
              onChange={(e) => setResultText(e.target.value)}
              rows={5}
            />
            <div className="flex justify-end gap-2 mt-1">
              <Button variant="outline" size="sm" onPress={handleCopy}>
                {copied ? <><Check size={13} /> Copiado!</> : <><Copy size={13} /> Copiar</>}
              </Button>
              <Button variant="primary" size="sm" onPress={handleReplaceAndClose}>
                <Clipboard size={13} /> Substituir e fechar
              </Button>
            </div>
          </div>
        )}
      </main>

      {/* Drawers */}
      {showSettings && settings && (
        <SettingsDrawer
          settings={settings}
          onSave={async (s) => {
            await updateSettings(s);
            if (isTauri()) invoke("apply_window_mode", { mode: s.windowMode ?? "popup" }).catch(() => {});
            setShowSettings(false);
          }}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showHistory && (
        <HistoryDrawer
          onSelect={handleHistorySelect}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  );
}
