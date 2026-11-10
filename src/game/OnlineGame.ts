import { isLocked, KEY_STEP, lockPointer, look, pull, unlockPointer } from "./orbitInput";
import { PITCH_DEFAULT, clampPitch } from "@/render/orbitCam";
import { easeAngle, easeToward, parseSnapshot, type BallTarget } from "@/online/interp";
import type { ClientMsg, ServerMsg } from "@/online/protocol";
import type { Ball, Vec2 } from "@/physics/types";
import { createScene, type SceneApi } from "@/render/scene";
import type { Group } from "@/rules/eightBall";
import type { Phase, UiState } from "./Game";
import { clampCuePlacement } from "./placement";

const DRAG_PX_FOR_FULL_POWER = 250;
const ZERO: Vec2 = { x: 0, y: 0 };
const SHOT_TIMEOUT_MS = 2000;
const AIM_SEND_MS = 80; // ≤ ~12 msgs/s (o servidor aceita 20/s)

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

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
  private pitch = PITCH_DEFAULT;
  private pullPx = 0;
  private lockWanted = false;
  private localCue: Vec2 | null = null;
  private sent = false;
  private holdCue = false;
  private pending: { timer: ReturnType<typeof setTimeout>; prev: Phase } | null = null;
  // O que o oponente está fazendo na vez dele (mira e branca na mão), suavizado.
  private oppAim: { angle: number; power: number; shownAngle: number; shownPower: number } | null = null;
  private oppCue: { target: Vec2; shown: Vec2 } | null = null;
  private lastAimSent = { at: 0, angle: 0, power: -1, x: -1, y: -1 };
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
    else if (m.t === "mira") this.applyOppAim(m.angulo, m.forca);
    else if (m.t === "branca") this.applyOppCue(m.x, m.y);
  }

  private applyOppAim(angulo: unknown, forca: unknown): void {
    if (this.phase !== "cpu" || this.estado?.fase !== "mira") return;
    if (!finite(angulo) || !finite(forca)) return;
    const power = Math.min(1, Math.max(0, forca));
    const a = this.oppAim;
    if (a) {
      a.angle = angulo;
      a.power = power;
    } else this.oppAim = { angle: angulo, power, shownAngle: angulo, shownPower: power };
  }

  private applyOppCue(x: unknown, y: unknown): void {
    if (this.phase !== "cpu" || this.estado?.fase !== "posicionando") return;
    if (!finite(x) || !finite(y)) return;
    const target = clampCuePlacement({ x, y }, this.others());
    if (this.oppCue) this.oppCue.target = target;
    else this.oppCue = { target, shown: target };
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
    unlockPointer();
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
    this.oppAim = null;
    this.oppCue = null;
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
    return this.localCue ?? this.oppCue?.shown ?? this.balls.get(0)?.pos ?? ZERO;
  }

  private others(): Ball[] {
    return [...this.balls.values()];
  }

  private applyView(): void {
    const aiming = this.phase === "aim" || this.phase === "cpu";
    if (this.view === "orbit" && aiming) this.scene.setView("orbit", this.cuePos(), this.aimAngle, this.pitch);
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

  // ---------- input ----------

  private onMove = (e: PointerEvent): void => {
    if (this.phase === "placing") {
      const p = this.scene.pick(e.clientX, e.clientY);
      if (p && !this.sent) this.localCue = clampCuePlacement(p, this.others());
      return;
    }
    if (this.phase !== "aim") return;
    if (this.view === "orbit") {
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
    if (this.dragStart) {
      const d = Math.hypot(e.clientX - this.dragStart.x, e.clientY - this.dragStart.y);
      this.power = Math.min(1, d / DRAG_PX_FOR_FULL_POWER);
      this.emit();
      return;
    }
    const p = this.scene.pick(e.clientX, e.clientY);
    if (!p) return;
    const c = this.cuePos();
    this.aimAngle = Math.atan2(p.y - c.y, p.x - c.x);
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
    if (this.view === "orbit" && this.lockWanted && !isLocked(this.container)) lockPointer(this.container);
    if (this.phase === "aim" && !this.sent) {
      this.dragStart = { x: e.clientX, y: e.clientY };
      this.pullPx = 0;
    }
  };

  private onUp = (): void => {
    if (this.phase !== "aim" || !this.dragStart) return;
    this.dragStart = null;
    this.pullPx = 0;
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
    this.pullPx = 0;
    this.power = 0;
    this.emit();
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

  // ---------- oponente ----------

  private updateOpponent(dt: number): void {
    const a = this.oppAim;
    if (this.phase === "cpu" && a) {
      a.shownAngle = easeAngle(a.shownAngle, a.angle, dt);
      a.shownPower += (a.power - a.shownPower) * (1 - Math.exp(-18 * dt));
      this.aimAngle = a.shownAngle;
      if (this.view === "orbit") this.applyView(); // câmera acompanha a mira dele
    }
    const c = this.oppCue;
    if (this.phase === "cpu" && c) c.shown = easeToward(c.shown, c.target, dt, 18);
  }

  private sendAim(now: number): void {
    if (this.sent || now - this.lastAimSent.at < AIM_SEND_MS) return;
    const l = this.lastAimSent;
    if (this.phase === "aim") {
      if (Math.abs(this.aimAngle - l.angle) < 0.002 && Math.abs(this.power - l.power) < 0.01) return;
      this.send({ t: "mirar", angulo: this.aimAngle, forca: this.power });
      this.lastAimSent = { ...l, at: now, angle: this.aimAngle, power: this.power };
    } else if (this.phase === "placing" && this.localCue) {
      const c = this.localCue;
      if (Math.abs(c.x - l.x) < 0.002 && Math.abs(c.y - l.y) < 0.002) return;
      this.send({ t: "mover_branca", x: c.x, y: c.y });
      this.lastAimSent = { ...l, at: now, x: c.x, y: c.y };
    }
  }

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
    this.updateOpponent(dt);
    this.sendAim(now);
    const list = this.others();
    const ghost = this.localCue && (this.phase === "placing" || this.holdCue) ? this.localCue : this.oppCue?.shown;
    if (ghost) {
      const i = list.findIndex((b) => b.id === 0);
      const cue: Ball = { id: 0, pos: ghost, vel: { ...ZERO }, pocketed: false };
      if (i >= 0) list[i] = cue;
      else list.push(cue);
    }
    this.scene.syncBalls(list);
    const oppAiming = this.phase === "cpu" && this.oppAim !== null;
    const showCue = this.phase === "aim" || oppAiming;
    const pull = this.phase === "aim" ? this.power : (this.oppAim?.shownPower ?? 0);
    this.scene.setCue(showCue, this.cuePos(), this.aimAngle, showCue ? pull * 0.25 : 0);
    this.scene.render();
  };
}
