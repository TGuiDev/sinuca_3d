import { isLocked, KEY_STEP, lockPointer, look, pull, unlockPointer } from "./orbitInput";
import { PITCH_DEFAULT, clampPitch } from "@/render/orbitCam";
import { chooseShot, type Shot } from "@/ai/cpu";
import { createWorld, isMoving, step, strike } from "@/physics/engine";
import { rackBalls, TABLE_H, TABLE_W } from "@/physics/table";
import type { Vec2, World } from "@/physics/types";
import { createScene, type SceneApi } from "@/render/scene";
import { newGame, resolveShot, type GameState, type Group } from "@/rules/eightBall";
import { clampCuePlacement } from "./placement";

export type Phase = "aim" | "rolling" | "placing" | "cpu" | "over";

export type UiState = {
  turn: 0 | 1;
  groups: [Group | null, Group | null];
  pocketed: number[];
  power: number;
  message: string;
  winner: 0 | 1 | null;
  phase: Phase;
  view: "top" | "orbit";
};

const DT = 1 / 120;
const DRAG_PX_FOR_FULL_POWER = 250;
const HEAD_SPOT: Vec2 = { x: TABLE_W / 4, y: TABLE_H / 2 };
const CPU_THINK_MS = 500;
const CPU_AIM_MS = 700;

export class Game {
  private scene: SceneApi;
  private world!: World;
  private rules!: GameState;
  private phase: Phase = "aim";
  private pocketed: number[] = [];
  private aimAngle = 0;
  private power = 0;
  private dragStart: { x: number; y: number } | null = null;
  private view: "top" | "orbit" = "top";
  private pitch = PITCH_DEFAULT;
  private pullPx = 0;
  private lockWanted = false;
  private cpuAt = 0;
  private cpuPlan: (Shot & { at: number }) | null = null;
  private raf = 0;
  private lastTime = 0;
  private acc = 0;
  private disposed = false;

  constructor(
    private container: HTMLElement,
    private onState: (s: UiState) => void,
  ) {
    this.scene = createScene(container);
    this.reset();
    container.addEventListener("pointermove", this.onMove);
    container.addEventListener("pointerdown", this.onDown);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("keydown", this.onKey);
    this.raf = requestAnimationFrame(this.frame);
  }

  restart(): void {
    this.reset();
  }

  setView(view: "top" | "orbit"): void {
    this.view = view;
    this.applyView();
    this.emit();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.container.removeEventListener("pointermove", this.onMove);
    this.container.removeEventListener("pointerdown", this.onDown);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("keydown", this.onKey);
    unlockPointer();
    this.scene.dispose();
  }

  // ---------- estado ----------

  private get cue() {
    return this.world.balls.find((b) => b.id === 0)!;
  }

  private reset(): void {
    this.world = createWorld(rackBalls());
    this.rules = newGame();
    this.pocketed = [];
    this.power = 0;
    this.dragStart = null;
    this.cpuPlan = null;
    this.aimAngle = 0;
    this.phase = "aim";
    this.applyView();
    this.emit();
  }

  private emit(): void {
    this.onState({
      turn: this.rules.current,
      groups: this.rules.groups,
      pocketed: [...this.pocketed],
      power: this.power,
      message: this.rules.message,
      winner: this.rules.winner,
      phase: this.phase,
      view: this.view,
    });
  }

  private applyView(): void {
    const aiming = this.phase === "aim" || this.phase === "cpu";
    if (this.view === "orbit" && aiming) this.scene.setView("orbit", this.cue.pos, this.aimAngle, this.pitch);
    else this.scene.setView("top");
    this.syncLock();
  }

  // Mouse travado só no modo orbital e fora da colocação da branca (que precisa do cursor).
  private syncLock(): void {
    const want = this.view === "orbit" && this.phase !== "placing" && this.phase !== "over";
    if (want === this.lockWanted) return;
    this.lockWanted = want;
    if (want) lockPointer(this.container);
    else unlockPointer();
  }

  private setPhase(phase: Phase): void {
    this.phase = phase;
    this.applyView();
    this.emit();
  }

  private finishShot(): void {
    const remaining = this.world.balls.filter((b) => !b.pocketed && b.id !== 0).map((b) => b.id);
    const report = this.world.report;
    this.pocketed.push(...report.pocketed.filter((id) => id !== 0));
    this.rules = resolveShot(this.rules, report, remaining);

    if (this.rules.winner !== null) {
      this.setPhase("over");
      return;
    }
    const human = this.rules.current === 0;
    if (this.rules.ballInHand) {
      const cue = this.cue;
      if (cue.pocketed) {
        cue.pocketed = false;
        cue.pos = { ...HEAD_SPOT };
        cue.vel = { x: 0, y: 0 };
      }
      if (!human) {
        cue.pos = clampCuePlacement(cue.pos, this.world.balls);
        this.rules = { ...this.rules, ballInHand: false };
      } else {
        this.setPhase("placing");
        return;
      }
    } else if (this.cue.pocketed) {
      this.cue.pocketed = false;
    }
    this.startTurn(human);
  }

  private startTurn(human: boolean): void {
    this.power = 0;
    if (human) this.setPhase("aim");
    else {
      this.cpuPlan = null;
      this.cpuAt = performance.now() + CPU_THINK_MS;
      this.setPhase("cpu");
    }
  }

  private fire(angle: number, power: number): void {
    strike(this.world, angle, power);
    this.power = 0;
    this.cpuPlan = null;
    this.scene.setCue(false, this.cue.pos, 0, 0);
    this.setPhase("rolling");
  }

  // ---------- input ----------

  private onMove = (e: PointerEvent): void => {
    if (this.phase === "placing") {
      const p = this.scene.pick(e.clientX, e.clientY);
      if (p) this.cue.pos = clampCuePlacement(p, this.world.balls);
      return;
    }
    if (this.view === "orbit" && this.phase === "aim") {
      if (this.dragStart) {
        const r = pull(this.pullPx, e.movementY);
        this.pullPx = r.px;
        this.power = r.power;
        this.emit();
      } else {
        const l = look({ angle: this.aimAngle, pitch: this.pitch }, e.movementX, e.movementY);
        this.aimAngle = l.angle;
        this.pitch = l.pitch;
        this.applyView();
      }
      return;
    }
    if (this.phase !== "aim" || this.dragStart) {
      if (this.phase === "aim" && this.dragStart) {
        const d = Math.hypot(e.clientX - this.dragStart.x, e.clientY - this.dragStart.y);
        this.power = Math.min(1, d / DRAG_PX_FOR_FULL_POWER);
        this.emit();
      }
      return;
    }
    const p = this.scene.pick(e.clientX, e.clientY);
    if (!p) return;
    this.aimAngle = Math.atan2(p.y - this.cue.pos.y, p.x - this.cue.pos.x);
    this.applyView();
  };

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    if (this.phase === "placing") {
      const p = this.scene.pick(e.clientX, e.clientY);
      if (p) this.cue.pos = clampCuePlacement(p, this.world.balls);
      this.rules = { ...this.rules, ballInHand: false, message: "Sua vez." };
      this.startTurn(true);
      return;
    }
    if (this.view === "orbit" && this.lockWanted && !isLocked(this.container)) lockPointer(this.container);
    if (this.phase === "aim") {
      this.dragStart = { x: e.clientX, y: e.clientY };
      this.pullPx = 0;
    }
  };

  private onUp = (): void => {
    if (this.phase !== "aim" || !this.dragStart) return;
    this.dragStart = null;
    this.pullPx = 0;
    if (this.power > 0.03) this.fire(this.aimAngle, this.power);
    else {
      this.power = 0;
      this.emit();
    }
  };

  private onKey = (e: KeyboardEvent): void => {
    if (e.key === "v" || e.key === "V") this.setView(this.view === "top" ? "orbit" : "top");
    else if (this.phase === "aim" && !this.dragStart) {
      const k = e.shiftKey ? KEY_STEP / 4 : KEY_STEP;
      if (e.key === "ArrowLeft") this.aimAngle -= k;
      else if (e.key === "ArrowRight") this.aimAngle += k;
      else if (this.view === "orbit" && e.key === "ArrowUp") this.pitch = clampPitch(this.pitch - k * 3);
      else if (this.view === "orbit" && e.key === "ArrowDown") this.pitch = clampPitch(this.pitch + k * 3);
      else return;
      e.preventDefault();
      this.applyView();
    }
  };

  // ---------- loop ----------

  private frame = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = this.lastTime ? Math.min((now - this.lastTime) / 1000, 0.05) : 0;
    this.lastTime = now;

    if (this.phase === "rolling") {
      this.acc += dt;
      while (this.acc >= DT) {
        step(this.world, DT);
        this.acc -= DT;
      }
      if (!isMoving(this.world)) {
        this.acc = 0;
        this.finishShot();
      }
    } else if (this.phase === "cpu") {
      this.runCpu(now);
    }

    this.scene.syncBalls(this.world.balls);
    this.updateCue();
    this.scene.render();
  };

  private runCpu(now: number): void {
    if (now < this.cpuAt) return;
    if (!this.cpuPlan) {
      const shot = chooseShot(this.world.balls, this.rules.groups[1]);
      this.cpuPlan = { ...shot, at: now };
      this.aimAngle = shot.angle;
      this.applyView();
    } else if (now - this.cpuPlan.at >= CPU_AIM_MS) {
      this.fire(this.cpuPlan.angle, this.cpuPlan.power);
    }
  }

  private updateCue(): void {
    const cue = this.cue;
    if (this.phase === "aim") {
      this.scene.setCue(true, cue.pos, this.aimAngle, this.power * 0.25);
    } else if (this.phase === "cpu" && this.cpuPlan) {
      const t = Math.min(1, (performance.now() - this.cpuPlan.at) / CPU_AIM_MS);
      this.scene.setCue(true, cue.pos, this.cpuPlan.angle, this.cpuPlan.power * 0.25 * t);
    } else {
      this.scene.setCue(false, cue.pos, 0, 0);
    }
  }
}
