import { clampPitch } from "@/render/orbitCam";

export const LOOK_SENS = 0.0028;
export const KEY_STEP = 0.012;
export const PULL_PX_FULL = 250;

export type Look = { angle: number; pitch: number };

// Gira a mira (movementX) e inclina a câmera (movementY).
export function look(l: Look, dx: number, dy: number): Look {
  return { angle: l.angle + dx * LOOK_SENS, pitch: clampPitch(l.pitch + dy * LOOK_SENS) };
}

// Puxar o mouse para baixo (movementY > 0) arma a tacada; subir desfaz.
export function pull(px: number, dy: number): { px: number; power: number } {
  const next = Math.max(0, px + dy);
  return { px: next, power: Math.min(1, next / PULL_PX_FULL) };
}

export function isLocked(el: HTMLElement): boolean {
  return typeof document !== "undefined" && document.pointerLockElement === el;
}

export function lockPointer(el: HTMLElement): void {
  try {
    const r = el.requestPointerLock() as unknown as Promise<void> | undefined;
    r?.catch?.(() => {});
  } catch {
    /* sem gesto do usuário ou sem suporte: segue sem travar */
  }
}

export function unlockPointer(): void {
  try {
    if (document.pointerLockElement) document.exitPointerLock();
  } catch {
    /* ignore */
  }
}
