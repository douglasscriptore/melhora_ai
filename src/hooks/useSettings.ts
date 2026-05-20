import { useState, useEffect, useCallback } from "react";
import { AppSettings } from "../types";
import { getSettings, saveSettings } from "../services/settings.service";

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getSettings().then((s) => {
      setSettings(s);
      setLoading(false);
    });
  }, []);

  const update = useCallback(async (next: AppSettings) => {
    await saveSettings(next);
    setSettings(next);
  }, []);

  return { settings, loading, updateSettings: update };
}
