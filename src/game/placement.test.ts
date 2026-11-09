import { describe, it, expect } from "vitest";
import { clampCuePlacement } from "./placement";
import { BALL_R, POCKETS, POCKET_R, TABLE_H, TABLE_W } from "@/physics/table";
import type { Ball } from "@/physics/types";

const ball = (id: number, x: number, y: number): Ball => ({
  id,
  pos: { x, y },
  vel: { x: 0, y: 0 },
  pocketed: false,
});

describe("clampCuePlacement", () => {
  it("position over another ball is pushed out by at least 2R", () => {
    const b = ball(1, 1.0, 0.6);
    const p = clampCuePlacement({ x: 1.0, y: 0.6 }, [b]);
    expect(Math.hypot(p.x - 1.0, p.y - 0.6)).toBeGreaterThanOrEqual(2 * BALL_R - 1e-9);
  });

  it("position outside table is clamped inside", () => {
    const p = clampCuePlacement({ x: -1, y: 5 }, []);
    expect(p.x).toBeGreaterThanOrEqual(BALL_R);
    expect(p.y).toBeLessThanOrEqual(TABLE_H - BALL_R);
    expect(p.x).toBeLessThanOrEqual(TABLE_W - BALL_R);
  });

  it("free position is unchanged", () => {
    expect(clampCuePlacement({ x: 0.7, y: 0.4 }, [ball(1, 1.5, 0.9)])).toEqual({ x: 0.7, y: 0.4 });
  });

  it("is never left inside a pocket", () => {
    for (const pk of POCKETS) {
      const p = clampCuePlacement({ x: pk.x, y: pk.y }, []);
      expect(Math.hypot(p.x - pk.x, p.y - pk.y)).toBeGreaterThanOrEqual(POCKET_R);
    }
  });

  it("ignores pocketed balls", () => {
    const b = { ...ball(1, 1.0, 0.6), pocketed: true };
    expect(clampCuePlacement({ x: 1.0, y: 0.6 }, [b])).toEqual({ x: 1.0, y: 0.6 });
  });
});
