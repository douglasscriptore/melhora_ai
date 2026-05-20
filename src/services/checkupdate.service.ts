export const CURRENT_VERSION = "0.2.1";

const REPO = "douglass/melhoraai";
export const RELEASES_URL = `https://github.com/${REPO}/releases`;
const API_LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;

export type UpdateStatus = "idle" | "checking" | "up_to_date" | "available" | "error";

export interface UpdateResult {
  status: Exclude<UpdateStatus, "idle" | "checking">;
  latestVersion: string | null;
  downloadUrl: string;
  errorMessage?: string;
}

function isNewer(latest: string, current: string): boolean {
  const l = latest.split(".").map(Number);
  const c = current.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((l[i] ?? 0) > (c[i] ?? 0)) return true;
    if ((l[i] ?? 0) < (c[i] ?? 0)) return false;
  }
  return false;
}

export async function checkForUpdate(): Promise<UpdateResult> {
  let res: Response;
  try {
    res = await fetch(API_LATEST, { headers: { Accept: "application/vnd.github+json" } });
  } catch {
    return { status: "error", latestVersion: null, downloadUrl: RELEASES_URL, errorMessage: "Sem conexão com a internet." };
  }

  if (res.status === 404) {
    return { status: "error", latestVersion: null, downloadUrl: RELEASES_URL, errorMessage: "Nenhuma release encontrada. O repositório pode ser privado." };
  }
  if (!res.ok) {
    return { status: "error", latestVersion: null, downloadUrl: RELEASES_URL, errorMessage: `Erro da API: HTTP ${res.status}.` };
  }

  const data = await res.json();
  const latestVersion = (data.tag_name as string).replace(/^v/, "");
  const isWin = /Windows/i.test(navigator.userAgent);
  const ext = isWin ? ".exe" : ".dmg";
  const asset = (data.assets as { name: string; browser_download_url: string }[])
    .find((a) => a.name.endsWith(ext));

  return {
    status: isNewer(latestVersion, CURRENT_VERSION) ? "available" : "up_to_date",
    latestVersion,
    downloadUrl: asset?.browser_download_url ?? RELEASES_URL,
  };
}
