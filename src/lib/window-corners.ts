import { invoke } from '@tauri-apps/api/core';

export interface RoundedCornersConfig {
  cornerRadius?: number;
}

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export function installTransparentWindowStyles(): () => void {
  const style = document.createElement('style');
  style.textContent = 'html,body,#root{background:transparent!important;}';
  document.head.appendChild(style);
  return () => style.remove();
}

export async function applyWindowCorners(config?: RoundedCornersConfig): Promise<void> {
  if (!isTauri()) return;

  try {
    await invoke('apply_window_corners', {
      radius: config?.cornerRadius ?? 14.0,
    });
  } catch (error) {
    console.error('Failed to apply window corners:', error);
  }
}
