import { useState } from "react";
import {
  Drawer, DrawerBackdrop, DrawerContent, DrawerDialog,
  DrawerHeader, DrawerHeading, DrawerBody, DrawerFooter, DrawerCloseTrigger,
  Button, Label, Checkbox, CheckboxControl, CheckboxIndicator, CheckboxContent,
  Select, SelectTrigger, SelectValue, SelectIndicator, SelectPopover,
  ListBox, ListBoxItem,
  useOverlayState,
} from "@heroui/react";
import { AppSettings } from "../types";
import { OPENAI_MODELS, CLAUDE_MODELS, MODEL_LABELS } from "../services/ai.service";

interface Props {
  settings: AppSettings;
  onSave: (s: AppSettings) => void;
  onClose: () => void;
}

const inputCls = [
  "w-full px-3 py-2 text-sm rounded-xl outline-none transition-colors font-sans",
  "border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]",
  "focus:border-[var(--accent)]",
].join(" ");

export function SettingsDrawer({ settings, onSave, onClose }: Props) {
  const [form, setForm] = useState<AppSettings>({ ...settings });
  const state = useOverlayState({ isOpen: true, onOpenChange: (open) => { if (!open) onClose(); } });
  const models = form.apiProvider === "claude" ? CLAUDE_MODELS : OPENAI_MODELS;

  function set<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "apiProvider") {
        next.model = value === "claude" ? CLAUDE_MODELS[0] : OPENAI_MODELS[0];
      }
      return next;
    });
  }

  return (
    <Drawer state={state}>
      <DrawerBackdrop variant="opaque" />
      <DrawerContent placement="right">
        <DrawerDialog>
          <DrawerHeader>
            <DrawerHeading>Configurações</DrawerHeading>
            <DrawerCloseTrigger />
          </DrawerHeader>

          <DrawerBody className="flex flex-col gap-5 py-5">

            {/* Provedor */}
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                Provedor de IA
              </Label>
              <Select
                selectedKey={form.apiProvider}
                onSelectionChange={(key) => set("apiProvider", key as AppSettings["apiProvider"])}
              >
                <SelectTrigger>
                  <SelectValue />
                  <SelectIndicator />
                </SelectTrigger>
                <SelectPopover>
                  <ListBox>
                    <ListBoxItem id="openai">OpenAI</ListBoxItem>
                    <ListBoxItem id="claude">Anthropic (Claude)</ListBoxItem>
                  </ListBox>
                </SelectPopover>
              </Select>
            </div>

            {/* API Key */}
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                Chave da API
              </Label>
              <input
                type="password"
                className={inputCls}
                placeholder={form.apiProvider === "claude" ? "sk-ant-..." : "sk-..."}
                value={form.apiKey}
                onChange={(e) => set("apiKey", e.target.value)}
              />
            </div>

            {/* Modelo */}
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                Modelo
              </Label>
              <Select
                selectedKey={form.model}
                onSelectionChange={(key) => set("model", String(key))}
              >
                <SelectTrigger>
                  <SelectValue />
                  <SelectIndicator />
                </SelectTrigger>
                <SelectPopover>
                  <ListBox>
                    {models.map((m) => <ListBoxItem key={m} id={m}>{MODEL_LABELS[m] ?? m}</ListBoxItem>)}
                  </ListBox>
                </SelectPopover>
              </Select>
            </div>

            {/* Tamanho máximo */}
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                Limite de caracteres
              </Label>
              <input
                type="number"
                className={inputCls}
                min={500}
                max={32000}
                value={form.maxTextLength}
                onChange={(e) => set("maxTextLength", Number(e.target.value))}
              />
            </div>

            {/* Modo de exibição */}
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                Modo de exibição
              </Label>
              <div className="flex gap-2">
                {(["popup", "window"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => set("windowMode", m)}
                    className="flex-1 py-2 px-3 text-sm rounded-xl border transition-colors cursor-pointer"
                    style={{
                      borderColor: form.windowMode === m ? "var(--accent)" : "var(--border)",
                      background: form.windowMode === m ? "var(--accent)" : "var(--surface)",
                      color: form.windowMode === m ? "#fff" : "var(--foreground)",
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
            </div>

            {/* Salvar histórico */}
            <Checkbox
              isSelected={form.saveHistory}
              onChange={(checked) => set("saveHistory", checked)}
            >
              <CheckboxControl><CheckboxIndicator /></CheckboxControl>
              <CheckboxContent>Salvar histórico local</CheckboxContent>
            </Checkbox>

          </DrawerBody>

          <DrawerFooter>
            <Button variant="outline" onPress={onClose}>Cancelar</Button>
            <Button variant="primary" onPress={() => onSave(form)}>Salvar</Button>
          </DrawerFooter>
        </DrawerDialog>
      </DrawerContent>
    </Drawer>
  );
}
