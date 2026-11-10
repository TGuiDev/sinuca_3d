import type { Vec2 } from "@/physics/types";
import type { ServerMsg } from "./protocol";

export type BallTarget = { x: number; y: number; pocketed: boolean };

type Snapshot = Extract<ServerMsg, { t: "snapshot" }>["bolas"];

export function parseSnapshot(bolas: Snapshot): Map<number, BallTarget> {
  const out = new Map<number, BallTarget>();
  for (const [id, x, y, p] of bolas) out.set(id, { x, y, pocketed: p === 1 });
  return out;
}

/** Aproximação exponencial independente de framerate. */
export function easeToward(current: Vec2, target: Vec2, dtSec: number, rate = 25): Vec2 {
  const k = 1 - Math.exp(-rate * Math.max(0, dtSec));
  return { x: current.x + (target.x - current.x) * k, y: current.y + (target.y - current.y) * k };
}
