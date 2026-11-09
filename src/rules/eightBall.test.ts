import { describe, it, expect } from "vitest";
import { newGame, resolveShot, type GameState } from "./eightBall";
import type { ShotReport } from "@/physics/types";

const ALL = Array.from({ length: 15 }, (_, i) => i + 1);
const rep = (firstHit: number | null, pocketed: number[] = [], rail = true): ShotReport => ({
  firstHit,
  pocketed,
  railAfterContact: rail,
});
const left = (...gone: number[]) => ALL.filter((id) => !gone.includes(id));
const assigned = (): GameState => ({ ...newGame(), groups: ["solids", "stripes"] });

describe("eight ball rules", () => {
  it("open table: pocketing a solid assigns solids to shooter and keeps turn", () => {
    const s = resolveShot(newGame(), rep(3, [3]), left(3));
    expect(s.current).toBe(0);
    expect(s.groups).toEqual(["solids", "stripes"]);
  });

  it("miss without pocketing passes turn", () => {
    const s = resolveShot(assigned(), rep(1), ALL);
    expect(s.current).toBe(1);
    expect(s.ballInHand).toBe(false);
  });

  it("cue ball pocketed is a foul: turn passes and ballInHand true", () => {
    const s = resolveShot(assigned(), rep(1, [0]), ALL);
    expect(s.current).toBe(1);
    expect(s.ballInHand).toBe(true);
  });

  it("first hit on opponent group is a foul", () => {
    const s = resolveShot(assigned(), rep(9, [1]), left(1));
    expect(s.current).toBe(1);
    expect(s.ballInHand).toBe(true);
  });

  it("no contact at all is a foul", () => {
    const s = resolveShot(assigned(), rep(null, [], false), ALL);
    expect(s.ballInHand).toBe(true);
    expect(s.current).toBe(1);
  });

  it("no rail after contact and nothing pocketed is a foul", () => {
    const s = resolveShot(assigned(), rep(1, [], false), ALL);
    expect(s.ballInHand).toBe(true);
  });

  it("pocketing 8 after clearing own group wins", () => {
    const s = resolveShot(assigned(), rep(8, [8]), [9, 10, 11, 12, 13, 14, 15]);
    expect(s.winner).toBe(0);
  });

  it("pocketing 8 early loses", () => {
    const s = resolveShot(assigned(), rep(1, [8]), left(8));
    expect(s.winner).toBe(1);
  });

  it("8 and cue pocketed together loses", () => {
    const s = resolveShot(assigned(), rep(8, [8, 0]), [9, 10, 11, 12, 13, 14, 15]);
    expect(s.winner).toBe(1);
    expect(s.ballInHand).toBe(false);
  });

  it("pocketing only opponent balls passes turn without foul", () => {
    const s = resolveShot(assigned(), rep(1, [9]), left(9));
    expect(s.current).toBe(1);
    expect(s.ballInHand).toBe(false);
  });

  it("hitting the 8 first on an open table is a foul", () => {
    const s = resolveShot(newGame(), rep(8, [3]), left(3));
    expect(s.ballInHand).toBe(true);
    expect(s.groups).toEqual([null, null]);
  });
});
