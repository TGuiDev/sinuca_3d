import { BALL_R, TABLE_H, TABLE_W } from "@/physics/table";
import type { Vec2 } from "@/physics/types";

export type AimGuide = { length: number; ghost: Vec2 | null };

const MAX_LEN = 3;

// Até onde a branca anda em linha reta: primeira bola atingida (centro da branca no impacto)
// ou a tabela. Só informativo; a física real continua no engine/servidor.
export function aimGuide(from: Vec2, angle: number, others: Vec2[]): AimGuide {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let best = MAX_LEN;
  let ghost: Vec2 | null = null;

  const lim = (o: number, d: number, min: number, max: number): number =>
    d > 1e-9 ? (max - o) / d : d < -1e-9 ? (min - o) / d : Infinity;
  const wall = Math.min(
    lim(from.x, dx, BALL_R, TABLE_W - BALL_R),
    lim(from.y, dy, BALL_R, TABLE_H - BALL_R),
  );
  if (wall >= 0 && wall < best) best = wall;

  const rr = 2 * BALL_R;
  for (const o of others) {
    const ox = o.x - from.x;
    const oy = o.y - from.y;
    const proj = ox * dx + oy * dy;
    if (proj <= 0) continue;
    const perp2 = ox * ox + oy * oy - proj * proj;
    if (perp2 > rr * rr) continue;
    const t = proj - Math.sqrt(rr * rr - perp2);
    if (t >= 0 && t < best) {
      best = t;
      ghost = { x: from.x + dx * t, y: from.y + dy * t };
    }
  }
  return { length: Math.max(0, best), ghost };
}
