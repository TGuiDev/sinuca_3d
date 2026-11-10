import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Assento, ClientMsg, ServerMsg } from "@/online/protocol";
import { Match } from "./match";

export type Conn = { send(msg: ServerMsg): void; close(): void };

export const GRACE_MS = 60_000;
export const IDLE_TTL_MS = 600_000;

type Seat = {
  nick: string;
  token: string;
  conn: Conn | null;
  discAt: number | null; // instante da desconexão (null = conectado)
  left: boolean; // saiu voluntariamente: não pode reconectar
  rematch: boolean;
};

const safeSend = (c: Conn, m: ServerMsg): void => {
  try {
    c.send(m);
  } catch {
    /* conexão morta: ignorada */
  }
};

const safeEqual = (a: string, b: string): boolean => {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
};

export class Room {
  creatorIp?: string;
  private seats: [Seat | null, Seat | null] = [null, null];
  private match: Match | null = null;
  private lastActivity: number | null = null;
  private lastConnected: number | null = null;

  constructor(
    readonly code: string,
    private readonly newToken: () => string = () => randomBytes(16).toString("hex"),
  ) {}

  join(nick: string, conn: Conn, now: number): { seat: 0 | 1; token: string } | null {
    if (this.isDead(now)) return null;
    const other = this.seats[0] ?? this.seats[1];
    if (other && (other.left || (other.discAt !== null && now - other.discAt > GRACE_MS))) return null;
    const idx = this.seats[0] === null ? 0 : this.seats[1] === null ? 1 : -1;
    if (idx < 0) return null;
    const seat = idx as 0 | 1;
    const token = this.newToken();
    this.seats[seat] = { nick, token, conn, discAt: null, left: false, rematch: false };
    this.touch(now);
    this.lastConnected = now;
    this.sendSala(seat);
    if (seat === 1) {
      this.match = new Match();
      this.broadcast({ t: "assentos", assentos: this.assentos() });
      this.broadcastState();
    }
    return { seat, token };
  }

  reconnect(token: string, conn: Conn, now: number): 0 | 1 | null {
    if (typeof token !== "string") return null;
    let found: 0 | 1 | null = null;
    for (const i of [0, 1] as const) {
      const s = this.seats[i];
      // sem saída antecipada: compara os dois assentos
      if (s && !s.left && safeEqual(s.token, token) && found === null) found = i;
    }
    if (found === null) return null;
    const s = this.seats[found]!;
    const old = s.conn;
    s.conn = conn;
    s.discAt = null;
    this.touch(now);
    this.lastConnected = now;
    if (old && old !== conn) {
      try {
        old.close();
      } catch {
        /* conexão já morta */
      }
    }
    this.sendSala(found);
    this.broadcast({ t: "assentos", assentos: this.assentos() });
    if (this.match) {
      safeSend(conn, this.estadoMsg());
      safeSend(conn, { t: "snapshot", bolas: this.match.snapshot() });
    }
    return found;
  }

  disconnect(seat: 0 | 1, conn: Conn, now: number): void {
    const s = this.seats[seat];
    if (!s || s.conn !== conn) return; // conexão obsoleta
    s.conn = null;
    s.discAt = now;
    s.rematch = false;
    this.touch(now);
    this.lastConnected = now;
    this.broadcast({ t: "assentos", assentos: this.assentos() });
  }

  handle(seat: 0 | 1, msg: ClientMsg, now: number): void {
    const s = this.seats[seat];
    if (!s || s.left) return;
    const m = this.match;
    const fase = m?.estado().fase;
    switch (msg.t) {
      case "tacada":
        if (!m || fase !== "mira") return;
        if (m.shoot(seat, msg.angulo, msg.forca)) {
          this.touch(now);
          this.broadcastState();
        }
        return;
      case "posicionar_branca":
        if (!m || fase !== "posicionando") return;
        if (m.place(seat, msg.x, msg.y)) {
          this.touch(now);
          this.broadcastState();
          this.broadcast({ t: "snapshot", bolas: m.snapshot() });
        }
        return;
      case "revanche":
        if (!m || fase !== "fim") return;
        s.rematch = true;
        this.touch(now);
        if (this.seats[0]?.rematch && this.seats[1]?.rematch) {
          for (const x of this.seats) if (x) x.rematch = false;
          this.match = new Match();
          this.broadcastState();
        }
        return;
      case "sair": {
        this.touch(now);
        if (m && fase !== "fim") {
          m.forfeit(seat, "W.O.: adversário saiu da partida");
        }
        s.left = true;
        s.discAt = now;
        const c = s.conn;
        s.conn = null;
        this.lastConnected = now;
        this.broadcast({ t: "assentos", assentos: this.assentos() });
        if (m) this.broadcastState();
        try {
          c?.close();
        } catch {
          /* já fechada */
        }
        return;
      }
      default:
        return;
    }
  }

  tick(now: number, dtMs: number): void {
    const m = this.match;
    if (!m) return;
    if (m.estado().fase !== "fim") {
      const gone = ([0, 1] as const)
        .filter((i) => {
          const s = this.seats[i];
          return s && s.discAt !== null && now - s.discAt > GRACE_MS;
        })
        .sort((x, y) => this.seats[x]!.discAt! - this.seats[y]!.discAt!)[0];
      if (gone !== undefined) {
        m.forfeit(gone, "W.O.: adversário desconectado");
        this.touch(now);
        this.broadcastState();
        return;
      }
    }
    const r = m.advance(dtMs);
    if (r === "moving") {
      this.broadcast({ t: "snapshot", bolas: m.snapshot() });
    } else if (r === "settled") {
      this.touch(now);
      this.broadcast({ t: "snapshot", bolas: m.snapshot() });
      this.broadcastState();
    }
  }

  isDead(now: number): boolean {
    if (this.lastActivity === null || this.lastConnected === null) return false;
    const anyConnected = this.seats.some((s) => s?.conn);
    if (!anyConnected && now - this.lastConnected > GRACE_MS) return true;
    return now - this.lastActivity > IDLE_TTL_MS;
  }

  private touch(now: number): void {
    this.lastActivity = now;
  }

  private assentos(): [Assento, Assento] {
    const f = (s: Seat | null): Assento => (s ? { apelido: s.nick, conectado: s.conn !== null } : null);
    return [f(this.seats[0]), f(this.seats[1])];
  }

  private sendSala(seat: 0 | 1): void {
    const s = this.seats[seat]!;
    if (s.conn) safeSend(s.conn, { t: "sala", codigo: this.code, assentos: this.assentos(), voce: seat, token: s.token });
  }

  private estadoMsg(): ServerMsg {
    return { t: "estado", ...this.match!.estado() };
  }

  private broadcastState(): void {
    if (!this.match) return;
    this.broadcast(this.estadoMsg());
    this.broadcast({ t: "snapshot", bolas: this.match.snapshot() });
  }

  private broadcast(msg: ServerMsg): void {
    for (const s of this.seats) if (s?.conn) safeSend(s.conn, msg);
  }
}
