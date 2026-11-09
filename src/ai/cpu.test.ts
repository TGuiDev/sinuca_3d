import { describe, it, expect } from "vitest";
import { chooseShot } from "./cpu";
import { createWorld, step, strike } from "@/physics/engine";
import type { Ball } from "@/physics/types";

const ball = (id: number, x: number, y: number): Ball => ({
  id,
  pos: { x, y },
  vel: { x: 0, y: 0 },
  pocketed: false,
});

function simulate(balls: Ball[], shot: { angle: number; power: number }) {
  const w = createWorld(balls.map((b) => ({ ...b, pos: { ...b.pos }, vel: { ...b.vel } })));
  strike(w, shot.angle, shot.power);
  for (let t = 0; t < 4; t += 1 / 120) step(w, 1 / 120);
  return w.report;
}

describe("cpu", () => {
  it("with rng=0.5 (no error) the shot pockets an easy target", () => {
    const balls = [ball(0, 1.0, 0.5), ball(1, 0.5, 0.25)];
    const r = simulate(balls, chooseShot(balls, "solids", () => 0.5));
    expect(r.pocketed).toContain(1);
  });

  it("only chooses balls of its group", () => {
    const balls = [ball(0, 0.6, 0.635), ball(1, 1.0, 0.635), ball(9, 1.2, 0.2)];
    const r = simulate(balls, chooseShot(balls, "stripes", () => 0.5));
    expect(r.firstHit).toBe(9);
  });

  it("returns a valid shot when every target is blocked", () => {
    const balls = [ball(0, 0.5, 0.635), ball(1, 1.0, 0.635), ball(9, 0.75, 0.635)];
    const s = chooseShot(balls, "solids", () => 0.5);
    expect(Number.isFinite(s.angle)).toBe(true);
    expect(s.power).toBeGreaterThan(0);
    expect(s.power).toBeLessThanOrEqual(1);
  });

  it("with group=null never aims first at the 8", () => {
    const balls = [ball(0, 0.5, 0.635), ball(8, 0.8, 0.635), ball(3, 1.5, 0.2)];
    const r = simulate(balls, chooseShot(balls, null, () => 0.5));
    expect(r.firstHit).toBe(3);
  });

  it("aims at the 8 when it is the only ball left", () => {
    const balls = [ball(0, 0.5, 0.635), ball(8, 1.2, 0.5)];
    const r = simulate(balls, chooseShot(balls, "solids", () => 0.5));
    expect(r.firstHit).toBe(8);
  });
});
