import { resolveShot, type GameState } from "@/rules/eightBall";
import { TABLE_H, TABLE_W } from "@/physics/table";
import type { Vec2, World } from "@/physics/types";

export const HEAD_SPOT: Vec2 = { x: TABLE_W / 4, y: TABLE_H / 2 };

/**
 * Fim de tacada para dois humanos. Muta apenas a bola branca de `world`;
 * `pocketed` de entrada nunca é alterado (retorna um novo array).
 */
export function settleShot(
  world: World,
  rules: GameState,
  pocketed: number[],
): { rules: GameState; pocketed: number[]; needsPlacement: boolean } {
  const remaining = world.balls.filter((b) => !b.pocketed && b.id !== 0).map((b) => b.id);
  const report = world.report;
  const nextPocketed = [...pocketed, ...report.pocketed.filter((id) => id !== 0)];
  const next = resolveShot(rules, report, remaining);
  const cue = world.balls.find((b) => b.id === 0);

  if (next.winner !== null) {
    return { rules: next, pocketed: nextPocketed, needsPlacement: false };
  }
  if (next.ballInHand) {
    if (cue && cue.pocketed) {
      cue.pocketed = false;
      cue.pos = { ...HEAD_SPOT };
      cue.vel = { x: 0, y: 0 };
    }
    return { rules: next, pocketed: nextPocketed, needsPlacement: true };
  }
  if (cue && cue.pocketed) cue.pocketed = false;
  return { rules: next, pocketed: nextPocketed, needsPlacement: false };
}
