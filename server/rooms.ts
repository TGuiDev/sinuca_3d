import { randomInt } from "node:crypto";
import { ALFABETO, ROOM_CODE_RE } from "@/online/protocol";
import type { ErroCodigo } from "@/online/protocol";
import { WindowCounter } from "./limits";
import { Room } from "./room";
import type { Conn } from "./room";

export type Limits = { maxRooms: number; maxRoomsPerIp: number; maxAttemptsPerMin: number; maxCreatesPerMin: number; maxReconnectsPerMin: number };
export type Result = { ok: true; room: Room; seat: 0 | 1; token: string } | { ok: false; erro: ErroCodigo };

const DEFAULTS: Limits = { maxRooms: 200, maxRoomsPerIp: 3, maxAttemptsPerMin: 10, maxCreatesPerMin: 5, maxReconnectsPerMin: 30 };
const ATTEMPT_WINDOW_MS = 60_000;
const fail = (erro: ErroCodigo): Result => ({ ok: false, erro });

export class RoomManager {
  private readonly limits: Limits;
  private readonly rooms = new Map<string, Room>();
  private readonly attempts: WindowCounter;
  private readonly creates: WindowCounter;
  private readonly reconnects: WindowCounter;

  constructor(limits: Partial<Limits> = {}) {
    this.limits = { ...DEFAULTS, ...limits };
    this.attempts = new WindowCounter(this.limits.maxAttemptsPerMin, ATTEMPT_WINDOW_MS);
    this.creates = new WindowCounter(this.limits.maxCreatesPerMin, ATTEMPT_WINDOW_MS);
    this.reconnects = new WindowCounter(this.limits.maxReconnectsPerMin, ATTEMPT_WINDOW_MS);
  }

  get size(): number {
    return this.rooms.size;
  }

  get(code: string): Room | undefined {
    return typeof code === "string" && ROOM_CODE_RE.test(code) ? this.rooms.get(code) : undefined;
  }

  private newCode(): string {
    for (;;) {
      let c = "";
      for (let i = 0; i < 6; i++) c += ALFABETO[randomInt(ALFABETO.length)];
      if (!this.rooms.has(c)) return c;
    }
  }

  create(ip: string, nick: string, conn: Conn, now: number): Result {
    if (!this.creates.hit(ip, now)) return fail("tente_depois");
    // salas já mortas (ainda não removidas pelo tick) não consomem cota
    let total = 0;
    let mine = 0;
    for (const r of this.rooms.values()) {
      if (r.isDead(now)) continue;
      total++;
      if (r.creatorIp === ip) mine++;
    }
    if (total >= this.limits.maxRooms || mine >= this.limits.maxRoomsPerIp) return fail("limite");
    const room = new Room(this.newCode());
    room.creatorIp = ip;
    const j = room.join(nick, conn, now);
    if (!j) return fail("limite"); // inalcançável: sala nova sempre aceita o criador
    this.rooms.set(room.code, room);
    return { ok: true, room, seat: j.seat, token: j.token };
  }

  join(ip: string, code: string, nick: string, conn: Conn, now: number): Result {
    if (!this.attempts.hit(ip, now)) return fail("tente_depois");
    const room = this.get(code);
    if (!room || room.isDead(now)) return fail("sala_inexistente");
    const j = room.join(nick, conn, now);
    // null para sala viva: cheia (ou fantasma sem vaga utilizável) -> sala_cheia
    return j ? { ok: true, room, seat: j.seat, token: j.token } : fail("sala_cheia");
  }

  reconnect(ip: string, code: string, token: string, conn: Conn, now: number): Result {
    if (!this.reconnects.hit(ip, now)) return fail("tente_depois");
    const room = this.get(code);
    if (!room || room.isDead(now)) return fail("sala_inexistente");
    const seat = room.reconnect(token, conn, now);
    return seat === null ? fail("token_invalido") : { ok: true, room, seat, token };
  }

  tick(now: number, dtMs: number): void {
    for (const [code, room] of this.rooms) {
      room.tick(now, dtMs);
      if (room.isDead(now)) {
        room.close();
        this.rooms.delete(code);
      }
    }
  }
}
