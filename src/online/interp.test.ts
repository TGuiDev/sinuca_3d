import { describe, expect, it } from "vitest";
import { easeToward, parseSnapshot } from "./interp";

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
