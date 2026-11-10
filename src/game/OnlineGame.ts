import { easeToward, parseSnapshot, type BallTarget } from "@/online/interp";
import type { ClientMsg, ServerMsg } from "@/online/protocol";
import type { Ball, Vec2 } from "@/physics/types";
import { createScene, type SceneApi } from "@/render/scene";
import type { Group } from "@/rules/eightBall";
import type { Phase, UiState } from "./Game";
import { clampCuePlacement } from "./placement";

const DRAG_PX_FOR_FULL_POWER = 250;
const ZERO: Vec2 = { x: 0, y: 0 };
const SHOT_TIMEOUT_MS = 2000;

type Estado = Extract<ServerMsg, { t: "estado" }>;

const toGroup = (g: string | null): Group | null => (g === "solids" || g === "stripes" ? g : null);

export class OnlineGame {
  private scene: SceneApi;
  private balls = new Map<number, Ball>();
  private targets = new Map<number, BallTarget>();
  private estado: Estado | null = null;
  private phase: Phase = "rolling";
  private aimAngle = 0;
  private power = 0;
  private dragStart: { x: number; y: number } | null = null;
  private view: "top" | "orbit" = "top";
  private localCue: Vec2 | null = null;
  private sent = false;
  private holdCue = false;
  private pending: { timer: ReturnType<typeof setTimeout>; prev: Phase } | null = null;
  private raf = 0;
  private lastTime = 0;
  private disposed = false;

  constructor(
    private container: HTMLElement,
    private you: 0 | 1,
    private names: [string, string],
    private send: (m: ClientMsg) => void,
    private onState: (s: UiState) => void,
  ) {
    this.scene = createScene(container);
    container.addEventListener("pointermove", this.onMove);
    container.addEventListener("pointerdown", this.onDown);
    container.addEventListener("pointercancel", this.onCancel);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onCancel);
    window.addEventListener("keydown", this.onKey);
    this.raf = requestAnimationFrame(this.frame);
  }

  get playerNames(): [string, string] {
    return this.names;
  }

  apply(m: ServerMsg): void {
    if (this.disposed) return;
    if (m.t === "snapshot") this.applySnapshot(m.bolas);
    else if (m.t === "estado") this.applyEstado(m);
  }

  setView(view: "top" | "orbit"): void {
    if (this.disposed) return;
    this.view = view;
    this.applyView();
    this.emit();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.clearPending();
    this.container.removeEventListener("pointermove", this.onMove);
    this.container.removeEventListener("pointerdown", this.onDown);
    this.container.removeEventListener("pointercancel", this.onCancel);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onCancel);
    window.removeEventListener("keydown", this.onKey);
    this.scene.dispose();
  }

  // ---------- estado ----------

  private applySnapshot(bolas: Extract<ServerMsg, { t: "snapshot" }>["bolas"]): void {
    this.clearPending();
    this.targets = parseSnapshot(bolas);
    for (const [id, t] of this.targets) {
      if (!this.balls.has(id)) {
        this.balls.set(id, { id, pos: { x: t.x, y: t.y }, vel: { ...ZERO }, pocketed: t.pocketed });
      }
    }
    for (const [id, b] of this.balls) if (!this.targets.has(id)) b.pocketed = true;
    const t0 = this.targets.get(0);
    const c0 = this.balls.get(0);
    if (this.holdCue && t0 && c0) c0.pos = { x: t0.x, y: t0.y };
    this.holdCue = false;
    if (this.phase !== "placing") this.localCue = null;
  }

  private applyEstado(e: Estado): void {
    this.clearPending();
    this.estado = e;
    this.sent = false;
    this.dragStart = null;
    this.power = 0;
    if (!this.holdCue) this.localCue = null;
    const mine = e.turno === this.you;
    if (e.fase === "fim") this.phase = "over";
    else if (e.fase === "rolando") this.phase = "rolling";
    else if (e.fase === "aguardando") return;
    else if (!mine) this.phase = "cpu";
    else this.phase = e.fase === "posicionando" ? "placing" : "aim";
    this.applyView();
    this.emit();
  }

  private emit(): void {
    const e = this.estado;
    if (!e || this.disposed) return;
    this.onState({
      turn: e.turno,
      groups: [toGroup(e.grupos[0]), toGroup(e.grupos[1])],
      pocketed: [...e.encacapadas],
      power: this.power,
      message: e.mensagem,
      winner: e.vencedor,
      phase: this.phase,
      view: this.view,
    });
  }

  private clearPending(): void {
    if (this.pending) clearTimeout(this.pending.timer);
    this.pending = null;
  }

  private armTimeout(prev: Phase): void {
    this.clearPending();
    const timer = setTimeout(() => {
      this.pending = null;
      if (this.disposed) return;
      this.sent = false;
      this.holdCue = false;
      this.localCue = null;
      this.phase = prev;
      this.applyView();
      this.emit();
    }, SHOT_TIMEOUT_MS);
    this.pending = { timer, prev };
  }

  private cuePos(): Vec2 {
    return this.localCue ?? this.balls.get(0)?.pos ?? ZERO;
  }

  private others(): Ball[] {
    return [...this.balls.values()];
  }

  private applyView(): void {
    const aiming = this.phase === "aim" || this.phase === "cpu";
    if (this.view === "orbit" && aiming) this.scene.setView("orbit", this.cuePos(), this.aimAngle);
    else this.scene.setView("top");
  }

  // ---------- input ----------

  private onMove = (e: PointerEvent): void => {
    if (this.phase === "placing") {
      const p = this.scene.pick(e.clientX, e.clientY);
      if (p && !this.sent) this.localCue = clampCuePlacement(p, this.others());
      return;
    }
    if (this.phase !== "aim") return;
    if (this.dragStart) {
      const d = Math.hypot(e.clientX - this.dragStart.x, e.clientY - this.dragStart.y);
      this.power = Math.min(1, d / DRAG_PX_FOR_FULL_POWER);
      this.emit();
      return;
    }
    if (this.view === "orbit") {
      this.aimAngle += e.movementX * 0.004;
    } else {
      const p = this.scene.pick(e.clientX, e.clientY);
      if (!p) return;
      const c = this.cuePos();
      this.aimAngle = Math.atan2(p.y - c.y, p.x - c.x);
    }
    this.applyView();
  };

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    if (this.phase === "placing") {
      if (this.sent) return;
      const p = this.scene.pick(e.clientX, e.clientY);
      const pos = clampCuePlacement(p ?? this.cuePos(), this.others());
      this.localCue = pos;
      this.sent = true;
      this.holdCue = true;
      this.send({ t: "posicionar_branca", x: pos.x, y: pos.y });
      this.armTimeout("placing");
      return;
    }
    if (this.phase === "aim" && !this.sent) this.dragStart = { x: e.clientX, y: e.clientY };
  };

  private onUp = (): void => {
    if (this.phase !== "aim" || !this.dragStart) return;
    this.dragStart = null;
    const forca = Math.min(1, Math.max(0, this.power));
    if (forca > 0.03) {
      this.sent = true;
      this.send({ t: "tacada", angulo: this.aimAngle, forca });
      this.armTimeout("aim");
      this.power = 0;
      this.phase = "rolling";
      this.applyView();
    } else this.power = 0;
    this.emit();
  };

  private onCancel = (): void => {
    if (!this.dragStart) return;
    this.dragStart = null;
    this.power = 0;
    this.emit();
  };

  private onKey = (e: KeyboardEvent): void => {
    if (e.key === "v" || e.key === "V") this.setView(this.view === "top" ? "orbit" : "top");
  };

  // ---------- loop ----------

  private frame = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = this.lastTime ? Math.min((now - this.lastTime) / 1000, 0.05) : 0;
    this.lastTime = now;

    for (const [id, b] of this.balls) {
      const t = this.targets.get(id);
      if (!t) continue;
      b.pocketed = t.pocketed;
      b.pos = easeToward(b.pos, t, dt);
    }
    const list = this.others();
    if (this.localCue && (this.phase === "placing" || this.holdCue)) {
      const i = list.findIndex((b) => b.id === 0);
      const cue: Ball = { id: 0, pos: this.localCue, vel: { ...ZERO }, pocketed: false };
      if (i >= 0) list[i] = cue;
      else list.push(cue);
    }
    this.scene.syncBalls(list);
    const showCue = this.phase === "aim";
    this.scene.setCue(showCue, this.cuePos(), this.aimAngle, showCue ? this.power * 0.25 : 0);
    this.scene.render();
  };
}
