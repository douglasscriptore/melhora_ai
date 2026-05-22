import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

export interface RoundedCornersConfig {
  cornerRadius?: number;
  offsetX?: number;
  offsetY?: number;
}

let currentConfig: RoundedCornersConfig | null = null;

export async function repositionTrafficLights(): Promise<void> {
  if (!currentConfig) return;
  try {
    const window = getCurrentWebviewWindow();
    await invoke('reposition_traffic_lights', {
      window,
      offsetX: currentConfig.offsetX ?? 0.0,
      offsetY: currentConfig.offsetY ?? 0.0,
    });
  } catch (error) {
    console.error('Failed to reposition traffic lights:', error);
  }
}

export async function enableRoundedCorners(config?: RoundedCornersConfig): Promise<void> {
  try {
    currentConfig = config || {};
    const window = getCurrentWebviewWindow();
    await invoke('enable_rounded_corners', {
      window,
      offsetX: config?.offsetX ?? 0.0,
      offsetY: config?.offsetY ?? 0.0,
    });
    setupResizeListener();
  } catch (error) {
    console.error('Failed to enable rounded corners:', error);
    throw error;
  }
}

export async function enableModernWindowStyle(config?: RoundedCornersConfig): Promise<void> {
  try {
    currentConfig = config || {};
    const window = getCurrentWebviewWindow();
    await invoke('enable_modern_window_style', {
      window,
      cornerRadius: config?.cornerRadius ?? 12.0,
      offsetX: config?.offsetX ?? 0.0,
      offsetY: config?.offsetY ?? 0.0,
    });
    setupResizeListener();
  } catch (error) {
    console.error('Failed to enable modern window style:', error);
    throw error;
  }
}

let unlistenResize: (() => void) | null = null;

async function setupResizeListener() {
  if (unlistenResize) unlistenResize();
  try {
    const window = getCurrentWebviewWindow();
    unlistenResize = await window.onResized(() => {
      repositionTrafficLights();
    });
  } catch (error) {
    console.error('Failed to setup resize listener:', error);
  }
}

export function cleanupRoundedCorners(): void {
  if (unlistenResize) {
    unlistenResize();
    unlistenResize = null;
  }
  currentConfig = null;
}
