import type { ShotReport } from "@/physics/types";

export type Group = "solids" | "stripes";

export type GameState = {
  current: 0 | 1;
  groups: [Group | null, Group | null];
  ballInHand: boolean;
  winner: 0 | 1 | null;
  message: string;
};

export function groupOf(id: number): Group | "eight" | "cue" {
  if (id === 0) return "cue";
  if (id === 8) return "eight";
  return id < 8 ? "solids" : "stripes";
}

export function newGame(): GameState {
  return {
    current: 0,
    groups: [null, null],
    ballInHand: false,
    winner: null,
    message: "Mesa aberta.",
  };
}

const other = (p: 0 | 1): 0 | 1 => (p === 0 ? 1 : 0);

export function resolveShot(state: GameState, report: ShotReport, remaining: number[]): GameState {
  const shooter = state.current;
  const opp = other(shooter);
  const cuePocketed = report.pocketed.includes(0);
  const eightPocketed = report.pocketed.includes(8);
  const pocketedObj = report.pocketed.filter((id) => id !== 0 && id !== 8);
  let groups = state.groups;
  const myGroup = groups[shooter];

  const mineBefore = myGroup
    ? [...remaining, ...pocketedObj].filter((id) => groupOf(id) === myGroup).length
    : null;
  const onEight = myGroup !== null && mineBefore === 0;

  if (eightPocketed) {
    const win = onEight && !cuePocketed;
    return {
      ...state,
      groups,
      ballInHand: false,
      winner: win ? shooter : opp,
      message: win ? "Bola 8 encaçapada. Vitória!" : "Bola 8 encaçapada cedo ou com falta. Derrota.",
    };
  }

  let foul = cuePocketed || report.firstHit === null;
  if (!foul && report.firstHit !== null) {
    const hit = groupOf(report.firstHit);
    if (onEight) foul = hit !== "eight";
    else if (myGroup) foul = hit !== myGroup;
    else foul = hit === "eight";
  }
  if (!foul && pocketedObj.length === 0 && !report.railAfterContact) foul = true;

  if (foul) {
    return {
      ...state,
      current: opp,
      ballInHand: true,
      message: "Falta! Bola branca na mão.",
    };
  }

  if (!myGroup && pocketedObj.length > 0) {
    const g = groupOf(pocketedObj[0]) as Group;
    const og: Group = g === "solids" ? "stripes" : "solids";
    groups = shooter === 0 ? [g, og] : [og, g];
  }

  const mine = groups[shooter];
  const scored = pocketedObj.some((id) => groupOf(id) === mine);
  return {
    ...state,
    groups,
    ballInHand: false,
    current: scored ? shooter : opp,
    message: scored ? "Boa! Jogue novamente." : "Vez do adversário.",
  };
}
