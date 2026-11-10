import { describe, expect, it } from "vitest";
import { BALL_R, TABLE_W } from "@/physics/table";
import { aimGuide } from "./aimGuide";

describe("aimGuide", () => {
  it("para na tabela quando não há bola", () => {
    const g = aimGuide({ x: 1, y: 0.6 }, 0, []);
    expect(g.ghost).toBeNull();
    expect(g.length).toBeCloseTo(TABLE_W - BALL_R - 1);
  });
  it("para na primeira bola, com o fantasma a 2R do centro", () => {
    const g = aimGuide({ x: 0.5, y: 0.6 }, 0, [{ x: 1.5, y: 0.6 }, { x: 2, y: 0.6 }]);
    expect(g.ghost).not.toBeNull();
    expect(g.ghost!.x).toBeCloseTo(1.5 - 2 * BALL_R);
  });
  it("ignora bola atrás ou fora da linha", () => {
    const g = aimGuide({ x: 1, y: 0.6 }, 0, [{ x: 0.5, y: 0.6 }, { x: 1.5, y: 0.9 }]);
    expect(g.ghost).toBeNull();
  });
});
