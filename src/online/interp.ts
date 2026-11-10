import type { Vec2 } from "@/physics/types";
import type { ServerMsg } from "./protocol";

export type BallTarget = { x: number; y: number; pocketed: boolean };

type Snapshot = Extract<ServerMsg, { t: "snapshot" }>["bolas"];

export function parseSnapshot(bolas: Snapshot): Map<number, BallTarget> {
  const out = new Map<number, BallTarget>();
  if (!Array.isArray(bolas)) return out;
  for (const e of bolas.slice(0, 16) as unknown[]) {
    if (!Array.isArray(e)) continue;
    const [id, x, y, p] = e as unknown[];
    if (typeof id !== "number" || !Number.isInteger(id) || id < 0 || id > 15) continue;
    if (typeof x !== "number" || !Number.isFinite(x)) continue;
    if (typeof y !== "number" || !Number.isFinite(y)) continue;
    out.set(id, { x, y, pocketed: p === 1 || p === true });
  }
  return out;
}

/** Aproxima ângulos (rad) pelo caminho mais curto, independente de framerate. */
export function easeAngle(current: number, target: number, dtSec: number, rate = 18): number {
  const k = 1 - Math.exp(-rate * Math.max(0, dtSec));
  const d = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + d * k;
}

/** Aproximação exponencial independente de framerate. */
export function easeToward(current: Vec2, target: Vec2, dtSec: number, rate = 25): Vec2 {
  const k = 1 - Math.exp(-rate * Math.max(0, dtSec));
  return { x: current.x + (target.x - current.x) * k, y: current.y + (target.y - current.y) * k };
}
