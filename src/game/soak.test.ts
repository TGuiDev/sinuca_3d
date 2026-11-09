import { describe, it, expect } from "vitest";
import { chooseShot } from "@/ai/cpu";
import { createWorld, isMoving, step, strike } from "@/physics/engine";
import { rackBalls, TABLE_H, TABLE_W } from "@/physics/table";
import { newGame, resolveShot } from "@/rules/eightBall";
import { clampCuePlacement } from "./placement";

function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

describe("full game soak (cpu vs cpu)", () => {
  it.each([1, 2, 3, 4, 5])("seed %i: finishes or runs 150 shots without invalid state", (seed) => {
    const rng = seeded(seed);
    const world = createWorld(rackBalls());
    let rules = newGame();
    let shots = 0;

    while (rules.winner === null && shots < 150) {
      const shot = chooseShot(world.balls, rules.groups[rules.current], rng);
      expect(Number.isFinite(shot.angle)).toBe(true);
      strike(world, shot.angle, shot.power);
      let guard = 0;
      while (isMoving(world) && guard++ < 120 * 60) step(world, 1 / 120);
      expect(isMoving(world), "shot never settled").toBe(false);

      for (const b of world.balls) {
        if (b.pocketed) continue;
        expect(Number.isFinite(b.pos.x) && Number.isFinite(b.pos.y)).toBe(true);
        expect(b.pos.x).toBeGreaterThanOrEqual(0);
        expect(b.pos.x).toBeLessThanOrEqual(TABLE_W);
        expect(b.pos.y).toBeGreaterThanOrEqual(0);
        expect(b.pos.y).toBeLessThanOrEqual(TABLE_H);
      }

      const remaining = world.balls.filter((b) => !b.pocketed && b.id !== 0).map((b) => b.id);
      rules = resolveShot(rules, world.report, remaining);
      const cue = world.balls.find((b) => b.id === 0)!;
      if (cue.pocketed) {
        cue.pocketed = false;
        cue.vel = { x: 0, y: 0 };
        cue.pos = clampCuePlacement({ x: TABLE_W / 4, y: TABLE_H / 2 }, world.balls);
      }
      shots++;
    }
    expect(shots).toBeGreaterThan(0);
  });
});
