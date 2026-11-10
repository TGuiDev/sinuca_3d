import { POCKETS } from "@/physics/table";
import type { Ball, Vec2, World } from "@/physics/types";
import { groupOf, type Group } from "@/rules/eightBall";

const TURN_RATE = 14; // rad/s: raio de curva ≈ v/14, menor que a caçapa em baixa velocidade
const MIN_SPEED = 0.55; // m/s: bola teleguiada não para antes de cair
const MAX_STEER_S = 6; // segurança: depois disso a física volta ao normal

export const STEER_LIMIT_S = MAX_STEER_S;

/** Bolas do jogador: do grupo dele (mesa aberta: qualquer uma menos a 8); a 8 só quando acabou o grupo. */
export function ownBallIds(balls: Ball[], group: Group | null): number[] {
  const alive = balls.filter((b) => !b.pocketed && b.id !== 0);
  if (group === null) return alive.filter((b) => b.id !== 8).map((b) => b.id);
  const mine = alive.filter((b) => groupOf(b.id) === group).map((b) => b.id);
  if (mine.length > 0) return mine;
  return alive.some((b) => b.id === 8) ? [8] : [];
}

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

function turnToward(b: Ball, to: Vec2, dt: number, minSpeed: number): void {
  const speed = Math.hypot(b.vel.x, b.vel.y);
  const want = Math.atan2(to.y - b.pos.y, to.x - b.pos.x);
  const have = speed > 1e-6 ? Math.atan2(b.vel.y, b.vel.x) : want;
  const diff = Math.atan2(Math.sin(want - have), Math.cos(want - have));
  const max = TURN_RATE * dt;
  const a = have + Math.max(-max, Math.min(max, diff));
  const s = Math.max(speed, minSpeed);
  b.vel = { x: Math.cos(a) * s, y: Math.sin(a) * s };
}

/**
 * Teleguia as bolas do jogador por um passo de física: antes do primeiro contato a branca persegue
 * a bola dele mais próxima; as bolas dele em movimento perseguem a caçapa mais próxima.
 */
export function steer(world: World, own: number[], dt: number): void {
  const ids = new Set(own);
  const cue = world.balls.find((b) => b.id === 0 && !b.pocketed);
  if (cue && world.report.firstHit === null && (cue.vel.x !== 0 || cue.vel.y !== 0)) {
    let best: Ball | null = null;
    for (const b of world.balls) {
      if (b.pocketed || !ids.has(b.id)) continue;
      if (!best || dist(cue.pos, b.pos) < dist(cue.pos, best.pos)) best = b;
    }
    if (best) turnToward(cue, best.pos, dt, 0);
  }
  for (const b of world.balls) {
    if (b.pocketed || !ids.has(b.id)) continue;
    if (b.vel.x === 0 && b.vel.y === 0) continue;
    let p = POCKETS[0];
    for (const q of POCKETS) if (dist(b.pos, q) < dist(b.pos, p)) p = q;
    turnToward(b, p, dt, MIN_SPEED);
  }
}
