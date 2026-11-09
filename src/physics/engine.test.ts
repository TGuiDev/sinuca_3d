import { describe, it, expect } from "vitest";
import { createWorld, strike, step, isMoving } from "./engine";
import { rackBalls, TABLE_H, TABLE_W } from "./table";
import type { Ball } from "./types";

const ball = (id: number, x: number, y: number, vx = 0, vy = 0): Ball => ({
  id,
  pos: { x, y },
  vel: { x: vx, y: vy },
  pocketed: false,
});

const run = (w: ReturnType<typeof createWorld>, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 120) step(w, 1 / 120);
};

describe("physics engine", () => {
  it("ball slows down and stops", () => {
    const w = createWorld([ball(0, 1.0, 0.635, 1, 0)]);
    run(w, 10);
    expect(isMoving(w)).toBe(false);
  });

  it("equal-mass head-on collision transfers velocity", () => {
    const w = createWorld([ball(0, 0.5, 0.635, 1, 0), ball(1, 0.7, 0.635)]);
    run(w, 0.2); // contato em ~0.14s; medir logo depois, antes do atrito
    const [cue, target] = w.balls;
    expect(Math.abs(cue.vel.x)).toBeLessThan(0.05);
    expect(target.vel.x).toBeGreaterThan(0.9);
    expect(target.vel.x).toBeLessThan(1.1);
  });

  it("rail reflects with restitution", () => {
    const w = createWorld([ball(1, 2.0, 0.635, 2, 0)]);
    run(w, 0.5);
    const b = w.balls[0];
    expect(b.vel.x).toBeLessThan(0);
    expect(Math.abs(b.vel.x)).toBeLessThan(2);
  });

  it("ball entering pocket is marked pocketed", () => {
    const w = createWorld([ball(3, 0.2, 0.2, -1.4, -1.4)]);
    run(w, 1);
    expect(w.balls[0].pocketed).toBe(true);
    expect(w.report.pocketed).toContain(3);
  });

  it("report records first ball touched by cue and rail after contact", () => {
    const w = createWorld([ball(0, 0.5, 0.635), ball(1, 1.0, 0.635)]);
    strike(w, 0, 0.5);
    run(w, 0.3);
    expect(w.report.firstHit).toBe(1);
    expect(w.report.railAfterContact).toBe(false);
    run(w, 1);
    expect(w.report.railAfterContact).toBe(true);
  });

  it("max power does not tunnel", () => {
    const w = createWorld([ball(0, 0.5, 0.635), ball(1, 0.6, 0.635)]);
    strike(w, 0, 1);
    run(w, 0.2);
    const [cue, target] = w.balls;
    expect(target.vel.x).toBeGreaterThan(0);
    expect(cue.pos.x).toBeLessThanOrEqual(target.pos.x);
  });

  it("rack has 16 balls with the 8 at the center of the triangle", () => {
    const balls = rackBalls();
    expect(balls).toHaveLength(16);
    expect(new Set(balls.map((b) => b.id)).size).toBe(16);
    const eight = balls.find((b) => b.id === 8)!;
    expect(eight.pos.y).toBeCloseTo(TABLE_H / 2, 3);
    expect(eight.pos.x).toBeGreaterThan(TABLE_W / 2);
  });
});
