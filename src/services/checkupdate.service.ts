export const CURRENT_VERSION = "0.2.10";
export const RELEASES_URL = "https://github.com/douglasscriptore/melhora_ai/releases";

type DownloadEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Update = { available: boolean; version: string; downloadAndInstall(cb: (e: DownloadEvent) => void): Promise<void> };

export type UpdateStatus =
  | "idle"
  | "checking"
  | "up_to_date"
  | "available"
  | "downloading"
  | "installing"
  | "error";

export interface CheckResult {
  status: "up_to_date" | "available" | "error";
  version?: string;
  errorMessage?: string;
}

let _pending: Update | null = null;

export async function checkForUpdate(): Promise<CheckResult> {
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    _pending = update;
    if (!update?.available) return { status: "up_to_date" };
    return { status: "available", version: update.version };
  } catch (e: unknown) {
    return {
      status: "error",
      errorMessage: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function downloadAndInstall(
  onProgress: (pct: number | null) => void
): Promise<void> {
  if (!_pending) throw new Error("Nenhuma atualização pendente.");
  let downloaded = 0;
  let total: number | undefined;

  await _pending.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength;
        onProgress(0);
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress(total ? Math.round((downloaded / total) * 100) : null);
        break;
      case "Finished":
        onProgress(100);
        break;
    }
  });

  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
