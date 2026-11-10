import { describe, expect, it } from "vitest";
import { look, pull } from "./orbitInput";
import { PITCH_MAX, PITCH_MIN } from "@/render/orbitCam";

describe("orbitInput", () => {
  it("gira e inclina com limite", () => {
    const l = look({ angle: 0, pitch: 0.3 }, 100, 100000);
    expect(l.angle).toBeGreaterThan(0);
    expect(l.pitch).toBe(PITCH_MAX);
    expect(look({ angle: 0, pitch: 0.3 }, 0, -100000).pitch).toBe(PITCH_MIN);
  });
  it("força cresce ao puxar, nunca fica negativa e satura em 1", () => {
    expect(pull(0, -50)).toEqual({ px: 0, power: 0 });
    expect(pull(100, 50).power).toBeCloseTo(0.6);
    expect(pull(240, 500).power).toBe(1);
  });
});
