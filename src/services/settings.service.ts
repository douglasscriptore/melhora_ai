import { load } from "@tauri-apps/plugin-store";
import { AppSettings } from "../types";

const STORE_FILE = "settings.json";

const DEFAULTS: AppSettings = {
  apiKey: "",
  apiProvider: "openai",
  model: "gpt-4o-mini",
  maxTextLength: 8000,
  saveHistory: true,
  windowMode: "popup",
  theme: "light",
};

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function getSettings(): Promise<AppSettings> {
  if (!isTauri()) return { ...DEFAULTS };
  const store = await load(STORE_FILE);
  const saved = await store.get<Partial<AppSettings>>("settings");
  return { ...DEFAULTS, ...(saved ?? {}) };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  if (!isTauri()) return;
  const store = await load(STORE_FILE);
  await store.set("settings", settings);
  await store.save();
}
