import { useState, useEffect } from "react";
import {
  Drawer, DrawerBackdrop, DrawerContent, DrawerDialog,
  DrawerHeader, DrawerHeading, DrawerBody,
  Button, Chip, ScrollShadow, useOverlayState,
} from "@heroui/react";
import { Trash2, X } from "lucide-react";
import { HistoryEntry } from "../types";
import { getHistory, clearHistory, deleteHistoryEntry } from "../services/history.service";

const MODE_LABELS: Record<string, string> = {
  corrigir_portugues: "Correção",
  melhorar_texto:     "Melhoria",
  resumir:            "Resumo",
};

function formatDate(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  return isToday
    ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) +
      " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

interface Props {
  onSelect: (entry: HistoryEntry) => void;
  onClose: () => void;
}

export function HistoryDrawer({ onSelect, onClose }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [confirmClear, setConfirmClear] = useState(false);
  const state = useOverlayState({ isOpen: true, onOpenChange: (open) => { if (!open) onClose(); } });

  useEffect(() => { getHistory().then(setEntries); }, []);

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    await deleteHistoryEntry(id);
    setEntries((prev) => prev.filter((entry) => entry.id !== id));
  }

  async function handleClear() {
    if (!confirmClear) { setConfirmClear(true); return; }
    await clearHistory();
    setEntries([]);
    setConfirmClear(false);
  }

  return (
    <Drawer state={state}>
      <DrawerBackdrop variant="opaque" />
      <DrawerContent placement="bottom">
        <DrawerDialog>
          <DrawerHeader className="py-2 px-4">
            <DrawerHeading className="text-sm">Histórico</DrawerHeading>
            <div className="flex items-center gap-1.5">
              {entries.length > 0 && (
                <Button
                  size="sm"
                  variant={confirmClear ? "danger" : "danger-soft"}
                  onPress={handleClear}
                  onBlur={() => setConfirmClear(false)}
                  className="text-xs h-7 px-2"
                >
                  <Trash2 size={12} /> {confirmClear ? "Confirmar?" : "Limpar tudo"}
                </Button>
              )}
              <Button size="sm" variant="ghost" isIconOnly aria-label="Fechar" onPress={onClose} className="h-7 w-7">
                <X size={14} />
              </Button>
            </div>
          </DrawerHeader>

          <DrawerBody className="p-0">
            <ScrollShadow className="max-h-[45vh]" hideScrollBar>
              {entries.length === 0 ? (
                <p className="text-center text-xs py-8" style={{ color: "var(--muted)" }}>
                  Nenhum registro ainda.
                </p>
              ) : (
                <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                  {entries.map((e) => (
                    <div
                      key={e.id}
                      className="group flex items-center gap-2 px-3 py-2 hover:bg-[var(--surface-secondary)] transition-colors"
                    >
                      {/* Clickable content area */}
                      <button
                        onClick={() => onSelect(e)}
                        className="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer"
                      >
                        <Chip size="sm" color="accent" variant="soft" className="shrink-0 text-[10px] px-1.5 h-5">
                          {MODE_LABELS[e.mode] ?? e.mode}
                        </Chip>
                        <span className="text-xs truncate flex-1" style={{ color: "var(--foreground)" }}>
                          {e.original_text.slice(0, 80)}{e.original_text.length > 80 ? "…" : ""}
                        </span>
                        <span className="text-[11px] shrink-0" style={{ color: "var(--muted)" }}>
                          {formatDate(e.created_at)}
                        </span>
                      </button>

                      {/* Delete button */}
                      <button
                        onClick={(ev) => handleDelete(ev, e.id)}
                        aria-label="Excluir"
                        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:text-red-500"
                        style={{ color: "var(--muted)" }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </ScrollShadow>
          </DrawerBody>
        </DrawerDialog>
      </DrawerContent>
    </Drawer>
  );
}
