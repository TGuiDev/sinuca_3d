import { BALL_R, POCKETS, POCKET_R, TABLE_H, TABLE_W } from "./table";
import type { Ball, World } from "./types";

const MAX_SPEED = 6; // m/s da branca com força 1
const FRICTION = 0.35; // m/s²
const STOP_SPEED = 0.01;
const BALL_RESTITUTION = 0.95;
const RAIL_RESTITUTION = 0.75;
const MAX_SUBSTEP = 1 / 480;

export function createWorld(balls: Ball[]): World {
  return { balls, report: { firstHit: null, pocketed: [], railAfterContact: false } };
}

export function strike(world: World, angle: number, power: number): void {
  const cue = world.balls.find((b) => b.id === 0 && !b.pocketed);
  world.report = { firstHit: null, pocketed: [], railAfterContact: false };
  if (!cue) return;
  const speed = Math.min(Math.max(power, 0), 1) * MAX_SPEED;
  cue.vel = { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed };
}

export function isMoving(world: World): boolean {
  return world.balls.some((b) => !b.pocketed && (b.vel.x !== 0 || b.vel.y !== 0));
}

export function step(world: World, dt: number): void {
  const n = Math.max(1, Math.ceil(dt / MAX_SUBSTEP));
  const h = dt / n;
  for (let i = 0; i < n; i++) substep(world, h);
}

function substep(world: World, h: number): void {
  const active = world.balls.filter((b) => !b.pocketed);

  for (const b of active) {
    b.pos.x += b.vel.x * h;
    b.pos.y += b.vel.y * h;
    const speed = Math.hypot(b.vel.x, b.vel.y);
    if (speed > 0) {
      const next = speed - FRICTION * h;
      if (next < STOP_SPEED) b.vel = { x: 0, y: 0 };
      else {
        const k = next / speed;
        b.vel.x *= k;
        b.vel.y *= k;
      }
    }
  }

  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) collide(world, active[i], active[j]);
  }

  for (const b of active) {
    if (pocket(world, b)) continue;
    rails(world, b);
  }
}

function collide(world: World, a: Ball, b: Ball): void {
  const dx = b.pos.x - a.pos.x;
  const dy = b.pos.y - a.pos.y;
  const dist = Math.hypot(dx, dy);
  if (dist >= 2 * BALL_R || dist === 0) return;

  const nx = dx / dist;
  const ny = dy / dist;
  const overlap = 2 * BALL_R - dist;
  a.pos.x -= (nx * overlap) / 2;
  a.pos.y -= (ny * overlap) / 2;
  b.pos.x += (nx * overlap) / 2;
  b.pos.y += (ny * overlap) / 2;

  const rel = (a.vel.x - b.vel.x) * nx + (a.vel.y - b.vel.y) * ny;
  if (rel <= 0) return; // já se afastando

  const j = ((1 + BALL_RESTITUTION) * rel) / 2;
  a.vel.x -= j * nx;
  a.vel.y -= j * ny;
  b.vel.x += j * nx;
  b.vel.y += j * ny;

  if (world.report.firstHit === null) {
    if (a.id === 0) world.report.firstHit = b.id;
    else if (b.id === 0) world.report.firstHit = a.id;
  }
}

function pocket(world: World, b: Ball): boolean {
  for (const p of POCKETS) {
    if (Math.hypot(b.pos.x - p.x, b.pos.y - p.y) < POCKET_R) {
      b.pocketed = true;
      b.vel = { x: 0, y: 0 };
      world.report.pocketed.push(b.id);
      return true;
    }
  }
  return false;
}

function rails(world: World, b: Ball): void {
  let hit = false;
  if (b.pos.x < BALL_R) {
    b.pos.x = BALL_R;
    if (b.vel.x < 0) b.vel.x *= -RAIL_RESTITUTION;
    hit = true;
  } else if (b.pos.x > TABLE_W - BALL_R) {
    b.pos.x = TABLE_W - BALL_R;
    if (b.vel.x > 0) b.vel.x *= -RAIL_RESTITUTION;
    hit = true;
  }
  if (b.pos.y < BALL_R) {
    b.pos.y = BALL_R;
    if (b.vel.y < 0) b.vel.y *= -RAIL_RESTITUTION;
    hit = true;
  } else if (b.pos.y > TABLE_H - BALL_R) {
    b.pos.y = TABLE_H - BALL_R;
    if (b.vel.y > 0) b.vel.y *= -RAIL_RESTITUTION;
    hit = true;
  }
  if (hit && world.report.firstHit !== null) world.report.railAfterContact = true;
}
