import { describe, expect, it } from "vitest";
import { TABLE_H, TABLE_W, BALL_R } from "@/physics/table";
import type { Ball } from "@/physics/types";
import { Match } from "./match";

const ball = (id: number, x: number, y: number): Ball => ({
  id,
  pos: { x, y },
  vel: { x: 0, y: 0 },
  pocketed: false,
});

function run(m: Match): void {
  for (let i = 0; i < 2000; i++) if (m.advance(33) === "settled") return;
  throw new Error("não assentou");
}

const cueOf = (m: Match) => m.snapshot().find((b) => b[0] === 0)!;

describe("Match", () => {
  it("snapshot inicial tem 16 entradas arredondadas a 4 casas", () => {
    const m = new Match();
    const s = m.snapshot();
    expect(s).toHaveLength(16);
    for (const [, x, y] of s) {
      expect(Math.round(x * 1e4) / 1e4).toBe(x);
      expect(Math.round(y * 1e4) / 1e4).toBe(y);
    }
  });

  it("shoot rejeita assento errado, valores inválidos e força baixa", () => {
    const m = new Match();
    expect(m.shoot(1, 0, 0.5)).toBe(false);
    expect(m.shoot(0, 0, 0.02)).toBe(false);
    expect(m.shoot(0, NaN, 0.5)).toBe(false);
    expect(m.shoot(0, 0, Infinity)).toBe(false);
    expect(m.shoot(0, 0, NaN)).toBe(false);
    expect(m.estado().fase).toBe("mira");
    expect(m.shoot(0, 0, 0.5)).toBe(true);
  });

  it("2º shoot válido durante rolando devolve false e não muda a velocidade", () => {
    const m = new Match();
    expect(m.shoot(0, 0, 0.5)).toBe(true);
    const before = cueOf(m);
    expect(m.estado().fase).toBe("rolando");
    expect(m.shoot(0, 1, 1)).toBe(false);
    expect(m.shoot(1, 1, 1)).toBe(false);
    expect(cueOf(m)).toEqual(before);
    m.advance(8);
    const a = cueOf(m);
    const m2 = new Match();
    m2.shoot(0, 0, 0.5);
    m2.advance(8);
    expect(a).toEqual(cueOf(m2));
  });

  it("força é clampada em 1", () => {
    const speed = (f: number) => {
      const m = new Match();
      m.shoot(0, 0, f);
      m.advance(8.34); // 1 passo
      const c = cueOf(m)[1];
      return c;
    };
    expect(speed(5)).toBe(speed(1));
  });

  it("tacada válida chega a settled e volta a mira/posicionando", () => {
    const m = new Match();
    m.shoot(0, 0, 0.8);
    run(m);
    expect(["mira", "posicionando"]).toContain(m.estado().fase);
  });

  it("falta leva a posicionando; só o adversário posiciona; posição é clampada", () => {
    const rack = [ball(0, 0.5, 0.5), ball(1, 2, 1)];
    const m = new Match({ rack });
    expect(m.shoot(0, Math.atan2(-0.5, -0.5), 1)).toBe(true);
    run(m);
    const e = m.estado();
    expect(e.fase).toBe("posicionando");
    expect(e.turno).toBe(1);
    expect(m.place(0, 1, 0.6)).toBe(false);
    expect(m.place(1, NaN, 0.6)).toBe(false);
    expect(m.place(1, -5, -5)).toBe(true);
    const [, x, y] = cueOf(m);
    expect(x).toBeGreaterThanOrEqual(BALL_R - 1e-3);
    expect(y).toBeGreaterThanOrEqual(BALL_R - 1e-3);
    expect(x).toBeLessThanOrEqual(TABLE_W);
    expect(y).toBeLessThanOrEqual(TABLE_H);
    expect(m.estado().fase).toBe("mira");
    expect(m.place(1, 1, 1)).toBe(false);
  });

  it("bola 8 cedo faz o adversário vencer", () => {
    const m = new Match({ rack: [ball(0, 0.6, 0.6), ball(8, 0.3, 0.3)] });
    m.shoot(0, Math.atan2(-1, -1), 1);
    run(m);
    const e = m.estado();
    expect(e.vencedor).toBe(1);
    expect(e.fase).toBe("fim");
  });

  it("maxShotSeconds encerra a tacada à força com velocidades zeradas", () => {
    const rack = [ball(0, 0.5, 0.6), ball(1, 2, 0.3)];
    const m = new Match({ rack, maxShotSeconds: 0.2 });
    expect(m.shoot(0, 0, 1)).toBe(true);
    expect(m.advance(8)).toBe("moving");
    expect(rack.some((b) => b.vel.x !== 0 || b.vel.y !== 0)).toBe(true);
    let r = "moving";
    for (let i = 0; i < 20 && r !== "settled"; i++) r = m.advance(33);
    expect(r).toBe("settled");
    for (const b of rack) expect(b.vel).toEqual({ x: 0, y: 0 });
    expect(m.estado().fase).not.toBe("rolando");
    const s1 = m.snapshot();
    m.advance(100);
    expect(m.snapshot()).toEqual(s1);
  });

  it("forfeit após fim não altera o resultado", () => {
    const m = new Match({ rack: [ball(0, 0.6, 0.6), ball(8, 0.3, 0.3)] });
    m.shoot(0, Math.atan2(-1, -1), 1);
    run(m);
    const e = m.estado();
    expect(e.fase).toBe("fim");
    m.forfeit(e.vencedor as 0 | 1, "W.O.");
    m.forfeit(e.vencedor === 0 ? 1 : 0, "W.O.");
    expect(m.estado().vencedor).toBe(e.vencedor);
    expect(m.estado().mensagem).toBe(e.mensagem);
  });

  it("branca respawnada sobre outra bola é afastada ao entrar em posicionando", () => {
    const rack = [ball(0, 0.5, 0.5), ball(1, 0.635, 0.635)];
    const m = new Match({ rack });
    m.shoot(0, Math.atan2(-0.5, -0.5), 1);
    run(m);
    expect(m.estado().fase).toBe("posicionando");
    const [, x, y] = cueOf(m);
    expect(Math.hypot(x - 0.635, y - 0.635)).toBeGreaterThanOrEqual(2 * BALL_R - 1e-3);
  });

  it("forfeit define vencedor e fim", () => {
    const m = new Match();
    m.forfeit(1, "W.O.");
    const e = m.estado();
    expect(e.vencedor).toBe(0);
    expect(e.fase).toBe("fim");
    expect(e.mensagem).toBe("W.O.");
    expect(m.shoot(0, 0, 0.5)).toBe(false);
  });
});
