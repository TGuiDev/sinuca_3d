import { BALL_R, POCKETS } from "@/physics/table";
import type { Ball, Vec2 } from "@/physics/types";
import { groupOf, type Group } from "@/rules/eightBall";

export type Shot = { angle: number; power: number };

const dist = (a: Vec2, b: Vec2) => Math.hypot(b.x - a.x, b.y - a.y);

// Distância do ponto p ao segmento a→b.
function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

function legalTargets(balls: Ball[], group: Group | null): Ball[] {
  const onTable = balls.filter((b) => !b.pocketed && b.id !== 0);
  if (group === null) {
    const open = onTable.filter((b) => b.id !== 8);
    return open.length > 0 ? open : onTable;
  }
  const mine = onTable.filter((b) => groupOf(b.id) === group);
  return mine.length > 0 ? mine : onTable.filter((b) => b.id === 8);
}

export function chooseShot(balls: Ball[], group: Group | null, rng: () => number = Math.random): Shot {
  const cue = balls.find((b) => b.id === 0 && !b.pocketed);
  if (!cue) return { angle: 0, power: 0.5 };
  const targets = legalTargets(balls, group);
  if (targets.length === 0) return { angle: 0, power: 0.5 };

  const blocked = (a: Vec2, b: Vec2, ignore: number[]) =>
    balls.some(
      (o) => !o.pocketed && o.id !== 0 && !ignore.includes(o.id) && segDist(o.pos, a, b) < 2 * BALL_R,
    );

  let best: { score: number; angle: number; total: number } | null = null;
  for (const t of targets) {
    for (const p of POCKETS) {
      const d = dist(t.pos, p);
      const dir = { x: (p.x - t.pos.x) / d, y: (p.y - t.pos.y) / d };
      const ghost = { x: t.pos.x - dir.x * 2 * BALL_R, y: t.pos.y - dir.y * 2 * BALL_R };
      const toGhost = dist(cue.pos, ghost);
      if (toGhost === 0) continue;
      const cos = ((ghost.x - cue.pos.x) * dir.x + (ghost.y - cue.pos.y) * dir.y) / toGhost;
      if (cos < 0.2) continue;
      if (blocked(cue.pos, ghost, [t.id]) || blocked(t.pos, p, [t.id])) continue;
      const total = toGhost + d;
      const score = total + (1 - cos) * 2;
      if (!best || score < best.score) {
        best = { score, total, angle: Math.atan2(ghost.y - cue.pos.y, ghost.x - cue.pos.x) };
      }
    }
  }

  const noise = (rng() - 0.5) * 0.04;
  if (best) {
    return { angle: best.angle + noise, power: Math.min(1, Math.max(0.3, 0.3 + best.total * 0.25)) };
  }

  // Fallback: prefere um alvo com caminho livre, senão o mais próximo.
  const free = targets.filter((t) => !blocked(cue.pos, t.pos, [t.id]));
  const pool = free.length > 0 ? free : targets;
  const nearest = pool.reduce((a, b) => (dist(cue.pos, a.pos) <= dist(cue.pos, b.pos) ? a : b));
  return {
    angle: Math.atan2(nearest.pos.y - cue.pos.y, nearest.pos.x - cue.pos.x) + noise,
    power: 0.6,
  };
}
