import { describe, expect, it } from "vitest";
import { clampPitch, orbitPose, PITCH_MAX, PITCH_MIN } from "./orbitCam";

describe("orbitPose", () => {
  it("fica atrás da branca no eixo da mira e olha para frente", () => {
    const { pos, look } = orbitPose(0, 0, 0, 0.3);
    expect(pos.x).toBeLessThan(0);
    expect(pos.z).toBeCloseTo(0);
    expect(look.x).toBeGreaterThan(0);
    expect(pos.y).toBeGreaterThan(0.09);
  });
  it("gira com o ângulo", () => {
    const { pos } = orbitPose(0, 0, Math.PI / 2, 0.3);
    expect(pos.z).toBeLessThan(0);
    expect(pos.x).toBeCloseTo(0);
  });
  it("limita a inclinação", () => {
    expect(clampPitch(-5)).toBe(PITCH_MIN);
    expect(clampPitch(5)).toBe(PITCH_MAX);
    expect(orbitPose(0, 0, 0, -5).pos.y).toBeGreaterThan(0.09);
  });
});
