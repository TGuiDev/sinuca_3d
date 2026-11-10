import { describe, expect, it } from "vitest";
import { easeAngle, easeToward, parseSnapshot } from "./interp";

describe("parseSnapshot", () => {
  it("mapeia bolas e flag de encaçapada", () => {
    const m = parseSnapshot([
      [3, 1.5, 0.5, 0],
      [8, 0, 0, 1],
    ]);
    expect(m.get(3)).toEqual({ x: 1.5, y: 0.5, pocketed: false });
    expect(m.get(8)?.pocketed).toBe(true);
    expect(m.size).toBe(2);
  });
});

describe("parseSnapshot (validação)", () => {
  const raw = (v: unknown) => v as Parameters<typeof parseSnapshot>[0];
  it("ignora coordenadas não finitas", () => {
    const m = parseSnapshot(raw([[1, NaN, 0, 0], [2, 0, Infinity, 0], [3, null, 0, 0], [4, 0, null, 0], [5, 1, 2, 0]]));
    expect([...m.keys()]).toEqual([5]);
  });
  it("ignora ids inválidos", () => {
    const m = parseSnapshot(raw([[99, 0, 0, 0], [-1, 0, 0, 0], [1.5, 0, 0, 0], [16, 0, 0, 0], [15, 0, 0, 0]]));
    expect([...m.keys()]).toEqual([15]);
  });
  it("limita a 16 entradas", () => {
    const many = Array.from({ length: 40 }, (_, i) => [i % 16, i, i, 0]);
    expect(parseSnapshot(raw(many)).size).toBeLessThanOrEqual(16);
    const late = [...Array.from({ length: 16 }, () => [99, 0, 0, 0]), [3, 0, 0, 0]];
    expect(parseSnapshot(raw(late)).size).toBe(0);
  });
  it("pocketed estrito", () => {
    const m = parseSnapshot(raw([[1, 0, 0, 2], [2, 0, 0, "1"], [3, 0, 0, 1], [4, 0, 0, true]]));
    expect([1, 2, 3, 4].map((i) => m.get(i)?.pocketed)).toEqual([false, false, true, true]);
  });
  it("não-array devolve mapa vazio", () => {
    expect(parseSnapshot(raw(null)).size).toBe(0);
  });
});

describe("easeToward", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 2, y: -1 };
  it("dt=0 devolve a posição atual", () => {
    expect(easeToward(a, b, 0)).toEqual(a);
  });
  it("converge com dt grande", () => {
    const r = easeToward(a, b, 10);
    expect(Math.hypot(r.x - b.x, r.y - b.y)).toBeLessThan(1e-6);
  });
  it("aproxima monotonicamente", () => {
    let cur = a;
    let prev = Math.hypot(b.x - a.x, b.y - a.y);
    for (let i = 0; i < 10; i++) {
      cur = easeToward(cur, b, 1 / 60);
      const d = Math.hypot(b.x - cur.x, b.y - cur.y);
      expect(d).toBeLessThan(prev);
      prev = d;
    }
  });
});

describe("easeAngle", () => {
  it("vai pelo caminho mais curto através de ±π", () => {
    const a = easeAngle(Math.PI - 0.1, -Math.PI + 0.1, 0.1);
    expect(a).toBeGreaterThan(Math.PI - 0.1);
  });
  it("converge", () => {
    expect(easeAngle(0, 1, 10)).toBeCloseTo(1, 3);
  });
});
