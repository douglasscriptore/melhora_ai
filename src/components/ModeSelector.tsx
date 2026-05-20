import { Button } from "@heroui/react";
import { SpellCheck, Sparkles, FileText, LayoutTemplate, LucideIcon } from "lucide-react";
import { AIMode } from "../types";

interface ModeConfig {
  id: AIMode;
  label: string;
  Icon: LucideIcon;
  description: string;
}

const MODES: ModeConfig[] = [
  { id: "corrigir_portugues", label: "Corrigir", Icon: SpellCheck,      description: "Correção gramatical e ortográfica" },
  { id: "melhorar_texto",     label: "Melhorar", Icon: Sparkles,        description: "Clareza, fluidez e legibilidade" },
  { id: "resumir",            label: "Resumir",  Icon: FileText,        description: "Resumo objetivo dos pontos principais" },
  { id: "gerar_gc",           label: "GC",       Icon: LayoutTemplate,  description: "Gerar título (61) + subtítulo (79) para painel" },
];

interface Props {
  selected: AIMode;
  onChange: (mode: AIMode) => void;
  disabled?: boolean;
}

export function ModeSelector({ selected, onChange, disabled }: Props) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {MODES.map(({ id, label, Icon, description }) => (
        <Button
          key={id}
          size="sm"
          variant={selected === id ? "primary" : "outline"}
          isDisabled={disabled}
          aria-label={description}
          onPress={() => onChange(id)}
        >
          <Icon size={14} />
          {label}
        </Button>
      ))}
    </div>
  );
}
