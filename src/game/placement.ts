import { BALL_R, POCKETS, POCKET_R, TABLE_H, TABLE_W } from "@/physics/table";
import type { Ball, Vec2 } from "@/physics/types";

// Afasta `p` de `from` até a distância mínima `min` (se estiver mais perto).
function pushAway(p: Vec2, from: Vec2, min: number): Vec2 {
  const dx = p.x - from.x;
  const dy = p.y - from.y;
  const d = Math.hypot(dx, dy);
  if (d >= min) return p;
  if (d === 0) return { x: from.x + min, y: from.y };
  return { x: from.x + (dx / d) * min, y: from.y + (dy / d) * min };
}

const clampToTable = (p: Vec2): Vec2 => ({
  x: Math.min(Math.max(p.x, BALL_R), TABLE_W - BALL_R),
  y: Math.min(Math.max(p.y, BALL_R), TABLE_H - BALL_R),
});

/** Posição válida para a branca: dentro da mesa, fora de caçapas e sem sobrepor bolas. */
export function clampCuePlacement(p: Vec2, balls: Ball[]): Vec2 {
  let pos = clampToTable(p);
  for (let i = 0; i < 8; i++) {
    const before = pos;
    for (const b of balls) {
      if (b.pocketed || b.id === 0) continue;
      pos = pushAway(pos, b.pos, 2 * BALL_R);
    }
    for (const pk of POCKETS) pos = pushAway(pos, pk, POCKET_R + 0.005);
    pos = clampToTable(pos);
    if (pos === before) break;
  }
  return pos;
}
