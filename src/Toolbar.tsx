import { useState, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, X, Check, AlertCircle, Sparkles } from "lucide-react";
import { useSettings } from "./hooks/useSettings";
import { processText } from "./services/ai.service";
import { AIMode } from "./types";
import "./App.css";

interface FocusPayload { x: number; y: number; w: number; h: number; text: string; }

const MODES: { id: AIMode; label: string; color: string }[] = [
  { id: "corrigir_portugues", label: "Corrigir", color: "#3b82f6" },
  { id: "melhorar_texto",     label: "Melhorar", color: "#8b5cf6" },
  { id: "resumir",            label: "Resumir",  color: "#f59e0b" },
  { id: "gerar_gc",           label: "GC",       color: "#06b6d4" },
];

export default function Toolbar() {
  const { settings, loading } = useSettings();
  const [currentText, setCurrentText]   = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [doneMode, setDoneMode]         = useState<AIMode | null>(null);
  const [error, setError]               = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [hovered, setHovered]           = useState<AIMode | null>(null);
  const [animKey, setAnimKey]           = useState(0);
  const prevFieldRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (settings) document.documentElement.setAttribute("data-theme", settings.theme ?? "light");
  }, [settings?.theme]);

  useEffect(() => {
    invoke<boolean>("check_ax_permission").then(setHasPermission).catch(() => setHasPermission(false));
    // Prevent HeroUI body background from covering transparent corners
    const style = document.createElement("style");
    style.textContent = "html,body,#root{background:transparent!important;}";
    document.head.appendChild(style);
    // Clip native macOS window frame to rounded corners
    invoke("set_corner_radius", { radius: 16.0 }).catch(() => {});
  }, []);

  useEffect(() => {
    let unFocus: (() => void) | undefined;
    let unBlur:  (() => void) | undefined;
    let unDenied:(() => void) | undefined;

    listen<FocusPayload>("ax-focus-changed", (e) => {
      const { x, y, text } = e.payload;
      setCurrentText(text);
      setDoneMode(null);
      setError(false);
      // Only retrigger entrance animation when focus moves to a different field
      const prev = prevFieldRef.current;
      const isNewField = !prev || Math.abs(prev.x - x) > 10 || Math.abs(prev.y - y) > 10;
      prevFieldRef.current = { x, y };
      if (isNewField) setAnimKey((k) => k + 1);
    }).then((f) => { unFocus = f; });

    listen("ax-focus-lost", () => {
      setCurrentText("");
      setDoneMode(null);
      setError(false);
      prevFieldRef.current = null;
    }).then((f) => { unBlur = f; });

    listen("ax-permission-denied", () => {
      setHasPermission(false);
    }).then((f) => { unDenied = f; });

    return () => { unFocus?.(); unBlur?.(); unDenied?.(); };
  }, []);

  async function handleMode(mode: AIMode) {
    if (!currentText.trim() || !settings || isProcessing) return;
    setIsProcessing(true);
    setError(false);
    setDoneMode(null);
    try {
      const targetPid = await invoke<number | null>("get_target_pid").catch(() => null);
      const result = await processText(currentText, mode, settings, () => {});
      await invoke("inject_result", { text: result.text, pid: targetPid });
      setDoneMode(mode);
      setTimeout(() => {
        setDoneMode(null);
        invoke("hide_toolbar");
      }, 1500);
    } catch {
      setError(true);
      setTimeout(() => setError(false), 2500);
    } finally {
      setIsProcessing(false);
    }
  }

  if (loading) return null;

  const hasKey = !!(settings?.apiKeys?.[settings.apiProvider ?? "openai"]);
  const isDark = settings?.theme === "dark";

  const bg     = isDark ? "rgba(18,18,28,0.97)" : "rgba(255,255,255,0.97)";
  const border = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)";
  const muted  = isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.4)";
  const fg     = isDark ? "#f1f5f9" : "#0f172a";

  return (
    <div
      key={animKey}
      data-tauri-drag-region
      className="toolbar-enter"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "6px",
        padding: "0 10px",
        height: "100%",
        width: "100%",
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: "16px",
        boxShadow: isDark
          ? "0 8px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.06)"
          : "0 8px 32px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.9)",
        userSelect: "none",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
        boxSizing: "border-box",
      }}
    >
      {/* Logo badge */}
      <div
        data-tauri-drag-region
        style={{
          width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
          background: "linear-gradient(135deg, #2563eb, #7c3aed)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <Sparkles size={12} color="#fff" />
      </div>

      {/* Divider */}
      <div style={{ width: 1, height: 20, background: border, flexShrink: 0 }} />

      {/* Content */}
      <div style={{ display: "flex", alignItems: "center", gap: "4px", flex: 1, minWidth: 0 }}>
        {hasPermission === false ? (
          <>
            <AlertCircle size={13} color="#ef4444" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: muted, flex: 1 }}>Permissão de Acessibilidade necessária</span>
            <button
              style={ghostBtnStyle(isDark)}
              onClick={async () => {
                const { openUrl } = await import("@tauri-apps/plugin-opener");
                await openUrl("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility");
              }}
            >
              Abrir
            </button>
          </>
        ) : !hasKey ? (
          <span style={{ fontSize: 11, color: muted }}>Configure sua API em Melhora.AI</span>
        ) : isProcessing ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, justifyContent: "center" }}>
            <Loader2 size={14} color="#6366f1" style={{ animation: "spin 0.8s linear infinite" }} />
            <span style={{ fontSize: 11, color: muted }}>Processando...</span>
          </div>
        ) : error ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <AlertCircle size={13} color="#ef4444" />
            <span style={{ fontSize: 11, color: "#ef4444" }}>Erro — tente novamente</span>
          </div>
        ) : !currentText.trim() ? (
          <span style={{ fontSize: 11, color: muted }}>Foque em um campo de texto...</span>
        ) : (
          MODES.map((m) => {
            const done = doneMode === m.id;
            const hot  = hovered === m.id;
            return (
              <button
                key={m.id}
                onMouseEnter={() => setHovered(m.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => handleMode(m.id)}
                style={{
                  height: 30,
                  padding: "0 11px",
                  borderRadius: 20,
                  border: `1px solid ${done ? m.color : hot ? m.color + "80" : border}`,
                  background: done
                    ? m.color + "22"
                    : hot
                    ? m.color + "14"
                    : "transparent",
                  color: done ? m.color : hot ? m.color : fg,
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  flexShrink: 0,
                  transition: "all 0.12s ease",
                  fontFamily: "inherit",
                  whiteSpace: "nowrap",
                }}
              >
                {done ? <><Check size={11} />{" "}OK</> : m.label}
              </button>
            );
          })
        )}
      </div>

      {/* Close */}
      <button
        style={{ ...ghostBtnStyle(isDark), width: 26, height: 26, padding: 0, borderRadius: "50%", flexShrink: 0 }}
        onClick={() => invoke("hide_toolbar")}
        aria-label="Fechar"
      >
        <X size={12} color={muted} />
      </button>
    </div>
  );
}

function ghostBtnStyle(isDark: boolean): React.CSSProperties {
  return {
    height: 26,
    padding: "0 8px",
    borderRadius: 8,
    border: "1px solid transparent",
    background: "transparent",
    color: isDark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.45)",
    fontSize: 11,
    fontWeight: 500,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "inherit",
    transition: "background 0.1s",
  };
}
