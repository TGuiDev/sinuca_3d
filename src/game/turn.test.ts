import { describe, expect, it } from "vitest";
import { HEAD_SPOT, settleShot } from "./turn";
import { newGame } from "@/rules/eightBall";
import { createWorld } from "@/physics/engine";
import type { Ball, ShotReport } from "@/physics/types";

const ball = (id: number, x: number, y: number, pocketed = false): Ball => ({
  id,
  pos: { x, y },
  vel: { x: 0.3, y: 0.1 },
  pocketed,
});

function world(balls: Ball[], report: Partial<ShotReport>) {
  const w = createWorld(balls);
  w.report = { firstHit: null, pocketed: [], railAfterContact: false, ...report };
  return w;
}

describe("settleShot", () => {
  it("encaçapa lisa com mesa aberta: define grupo e mantém a vez", () => {
    const w = world([ball(0, 1, 0.6), ball(1, 2, 1, true), ball(9, 1.5, 0.3), ball(8, 2, 0.5)], {
      firstHit: 1,
      pocketed: [1],
      railAfterContact: true,
    });
    const r = settleShot(w, newGame(), []);
    expect(r.rules.groups[0]).toBe("solids");
    expect(r.rules.current).toBe(0);
    expect(r.needsPlacement).toBe(false);
    expect(r.pocketed).toContain(1);
    expect(r.pocketed).not.toContain(0);
  });

  it("branca encaçapada: falta, vez do outro, branca em HEAD_SPOT", () => {
    const w = world([ball(0, 1, 0.6, true), ball(9, 1.5, 0.3)], {
      firstHit: 9,
      pocketed: [0],
      railAfterContact: true,
    });
    const r = settleShot(w, newGame(), []);
    expect(r.rules.current).toBe(1);
    expect(r.needsPlacement).toBe(true);
    const cue = w.balls[0];
    expect(cue.pos).toEqual(HEAD_SPOT);
    expect(cue.pocketed).toBe(false);
    expect(cue.vel).toEqual({ x: 0, y: 0 });
    expect(r.pocketed).not.toContain(0);
  });

  it("branca + 8 na tacada final: atirador perde, sem posicionamento", () => {
    const w = world([ball(0, 1, 0.6, true), ball(8, 2, 1, true)], {
      firstHit: 8,
      pocketed: [0, 8],
      railAfterContact: true,
    });
    const state = { ...newGame(), groups: ["solids", "stripes"] as const };
    const r = settleShot(w, { ...state, groups: ["solids", "stripes"] }, []);
    expect(r.rules.winner).toBe(1);
    expect(r.needsPlacement).toBe(false);
  });

  it("não muta o pocketed de entrada", () => {
    const w = world([ball(0, 1, 0.6), ball(1, 2, 1, true), ball(9, 1.5, 0.3)], {
      firstHit: 1,
      pocketed: [1],
      railAfterContact: true,
    });
    const input = [5];
    const frozen = Object.freeze(input);
    const r = settleShot(w, newGame(), frozen as number[]);
    expect(input).toEqual([5]);
    expect(r.pocketed).toEqual([5, 1]);
    expect(r.pocketed).not.toBe(input);
  });
});
