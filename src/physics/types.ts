export type Vec2 = { x: number; y: number };

export type Ball = { id: number; pos: Vec2; vel: Vec2; pocketed: boolean };

export type ShotReport = {
  firstHit: number | null;
  pocketed: number[];
  railAfterContact: boolean;
};

export type World = { balls: Ball[]; report: ShotReport };
