import { BALL_R } from "@/physics/table";

export const PITCH_MIN = 0.07;
export const PITCH_MAX = 1.1;
export const PITCH_DEFAULT = 0.45;
export const ORBIT_DIST = 0.6;
export const ORBIT_FOV = 62;
export const TOP_FOV = 45;

export const clampPitch = (p: number): number => Math.min(PITCH_MAX, Math.max(PITCH_MIN, p));

export type Pose = {
  pos: { x: number; y: number; z: number };
  look: { x: number; y: number; z: number };
};

// Câmera de primeira pessoa: atrás da branca, no eixo da mira, olhando ao longo do taco.
// (fx, fz): branca na cena; angle: direção da tacada no plano; pitch: elevação em rad.
export function orbitPose(fx: number, fz: number, angle: number, pitch: number): Pose {
  const p = clampPitch(pitch);
  const dx = Math.cos(angle);
  const dz = Math.sin(angle);
  const back = ORBIT_DIST * Math.cos(p);
  return {
    pos: { x: fx - dx * back, y: BALL_R + ORBIT_DIST * Math.sin(p) + 0.02, z: fz - dz * back },
    look: { x: fx + dx * 0.8, y: BALL_R * 0.6, z: fz + dz * 0.8 },
  };
}
