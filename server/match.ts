import { clampCuePlacement } from "@/game/placement";
import { settleShot } from "@/game/turn";
import { createWorld, isMoving, step, strike } from "@/physics/engine";
import { rackBalls } from "@/physics/table";
import type { Ball, World } from "@/physics/types";
import { newGame, type GameState } from "@/rules/eightBall";
import type { Fase, ServerMsg } from "@/online/protocol";

export type MatchEstado = Omit<Extract<ServerMsg, { t: "estado" }>, "t">;
export type Snapshot = Extract<ServerMsg, { t: "snapshot" }>["bolas"];
export type Advance = "idle" | "moving" | "settled";

const DT = 1 / 120;
export const MAX_STEPS_PER_ADVANCE = 12;
const MIN_FORCE = 0.03;

const r4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Autoridade de uma partida: mundo físico + regras da Bola 8. Sem I/O. */
export class Match {
  private world: World;
  private rules: GameState = newGame();
  private fase: Fase = "mira";
  private pocketed: number[] = [];
  private acc = 0;
  private shotTime = 0;
  private readonly maxShotSeconds: number;

  constructor(opts?: { rack?: Ball[]; maxShotSeconds?: number }) {
    this.world = createWorld(opts?.rack ?? rackBalls());
    this.maxShotSeconds = opts?.maxShotSeconds ?? 30;
  }

  estado(): MatchEstado {
    return {
      turno: this.rules.current,
      grupos: [this.rules.groups[0], this.rules.groups[1]],
      encacapadas: [...this.pocketed],
      mensagem: this.rules.message,
      vencedor: this.rules.winner,
      fase: this.fase,
    };
  }

  snapshot(): Snapshot {
    return this.world.balls.map(
      (b) => [b.id, r4(b.pos.x), r4(b.pos.y), b.pocketed ? 1 : 0] as [number, number, number, 0 | 1],
    );
  }

  shoot(seat: 0 | 1, angulo: number, forca: number): boolean {
    if (this.fase !== "mira" || seat !== this.rules.current) return false;
    if (!Number.isFinite(angulo) || !Number.isFinite(forca) || forca < MIN_FORCE) return false;
    strike(this.world, angulo, Math.min(Math.max(forca, 0), 1));
    this.acc = 0;
    this.shotTime = 0;
    this.fase = "rolando";
    return true;
  }

  place(seat: 0 | 1, x: number, y: number): boolean {
    if (this.fase !== "posicionando" || seat !== this.rules.current) return false;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const cue = this.world.balls.find((b) => b.id === 0);
    if (!cue) return false;
    cue.pos = clampCuePlacement({ x, y }, this.world.balls);
    cue.vel = { x: 0, y: 0 };
    this.fase = "mira";
    return true;
  }

  advance(dtMs: number): Advance {
    if (this.fase !== "rolando") return "idle";
    if (Number.isFinite(dtMs) && dtMs > 0) {
      this.acc = Math.min(this.acc + dtMs / 1000, MAX_STEPS_PER_ADVANCE * DT);
    }
    let steps = 0;
    while (this.acc >= DT && steps < MAX_STEPS_PER_ADVANCE && isMoving(this.world)) {
      step(this.world, DT);
      this.acc -= DT;
      this.shotTime += DT;
      steps++;
    }
    if (isMoving(this.world) && this.shotTime >= this.maxShotSeconds) {
      for (const b of this.world.balls) b.vel = { x: 0, y: 0 };
    }
    if (isMoving(this.world)) return "moving";
    this.finishShot();
    return "settled";
  }

  forfeit(loser: 0 | 1, mensagem: string): void {
    if (this.fase === "fim") return;
    this.rules = { ...this.rules, winner: loser === 0 ? 1 : 0, message: mensagem };
    this.fase = "fim";
  }

  private finishShot(): void {
    const res = settleShot(this.world, this.rules, this.pocketed);
    this.rules = res.rules;
    this.pocketed = res.pocketed;
    if (this.rules.winner !== null) {
      this.fase = "fim";
    } else if (res.needsPlacement) {
      const cue = this.world.balls.find((b) => b.id === 0);
      if (cue) cue.pos = clampCuePlacement(cue.pos, this.world.balls);
      this.fase = "posicionando";
    } else {
      this.fase = "mira";
    }
  }
}
