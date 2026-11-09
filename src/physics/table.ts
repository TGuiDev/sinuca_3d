import type { Ball, Vec2 } from "./types";

export const TABLE_W = 2.54;
export const TABLE_H = 1.27;
export const BALL_R = 0.028575;
export const POCKET_R = 0.06;

export const POCKETS: Vec2[] = [
  { x: 0, y: 0 },
  { x: TABLE_W / 2, y: 0 },
  { x: TABLE_W, y: 0 },
  { x: 0, y: TABLE_H },
  { x: TABLE_W / 2, y: TABLE_H },
  { x: TABLE_W, y: TABLE_H },
];

// Ids por linha do triângulo; a 8 fica no centro e os cantos de trás são 1 lisa e 1 listrada.
const RACK_ORDER = [1, 9, 2, 10, 8, 3, 4, 11, 5, 12, 6, 13, 14, 7, 15];

export function rackBalls(): Ball[] {
  const balls: Ball[] = [
    { id: 0, pos: { x: TABLE_W / 4, y: TABLE_H / 2 }, vel: { x: 0, y: 0 }, pocketed: false },
  ];
  const apexX = TABLE_W * 0.75;
  let i = 0;
  for (let row = 0; row < 5; row++) {
    for (let k = 0; k <= row; k++) {
      balls.push({
        id: RACK_ORDER[i++],
        pos: {
          x: apexX + row * Math.sqrt(3) * BALL_R * 1.002,
          y: TABLE_H / 2 + (k - row / 2) * 2 * BALL_R * 1.002,
        },
        vel: { x: 0, y: 0 },
        pocketed: false,
      });
    }
  }
  return balls;
}
