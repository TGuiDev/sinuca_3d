import { describe, expect, it } from "vitest";
import { createWorld, isMoving, step } from "@/physics/engine";
import type { Ball } from "@/physics/types";
import { ownBallIds, steer, STEER_LIMIT_S } from "./homing";

const ball = (id: number, x: number, y: number, vx = 0, vy = 0): Ball => ({
  id, pos: { x, y }, vel: { x: vx, y: vy }, pocketed: false,
});

describe("ownBallIds", () => {
  const all = [0, 1, 7, 8, 9, 15].map((i) => ball(i, 1, 1));
  it("grupo definido: só as dele; mesa aberta: tudo menos a 8 e a branca", () => {
    expect(ownBallIds(all, "solids")).toEqual([1, 7]);
    expect(ownBallIds(all, null)).toEqual([1, 7, 9, 15]);
  });
  it("a 8 só depois de limpar o grupo", () => {
    expect(ownBallIds([ball(0, 1, 1), ball(8, 1, 1), ball(9, 1, 1)], "solids")).toEqual([8]);
  });
});

describe("steer", () => {
  it("bola do jogador, lançada fora de rota, ainda cai numa caçapa", () => {
    const w = createWorld([ball(0, 0.4, 0.3), ball(3, 1.0, 0.5, 0, -0.9)]);
    let t = 0;
    while (t < STEER_LIMIT_S && !w.balls[1].pocketed) {
      steer(w, [3], 1 / 120);
      step(w, 1 / 120);
      t += 1 / 120;
    }
    expect(w.balls[1].pocketed).toBe(true);
  });
  it("não mexe em bola do adversário nem em bola parada", () => {
    const w = createWorld([ball(0, 0.4, 0.3), ball(3, 1, 0.5, 0, -0.9), ball(12, 1.5, 0.5)]);
    steer(w, [], 1 / 120);
    expect(w.balls[1].vel).toEqual({ x: 0, y: -0.9 });
    steer(w, [12], 1 / 120);
    expect(w.balls[2].vel).toEqual({ x: 0, y: 0 });
  });
  it("antes do contato a branca vira em direção à bola do jogador", () => {
    const w = createWorld([ball(0, 0.5, 0.6, 1, 0), ball(5, 1.0, 1.1)]);
    for (let i = 0; i < 20; i++) steer(w, [5], 1 / 120);
    expect(w.balls[0].vel.y).toBeGreaterThan(0);
  });
  it("termina: com o limite de tempo a mesa sempre assenta", () => {
    const w = createWorld([ball(0, 0.4, 0.3), ball(3, 1.0, 0.5, 0, -0.9)]);
    for (let i = 0; i < 120 * 60 && (isMoving(w) || i < 2); i++) {
      if (i / 120 < STEER_LIMIT_S) steer(w, [3], 1 / 120);
      step(w, 1 / 120);
    }
    expect(isMoving(w)).toBe(false);
  });
});
