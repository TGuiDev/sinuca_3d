import { describe, expect, it } from "vitest";
import { ROOM_CODE_RE } from "@/online/protocol";
import { RoomManager } from "./rooms";
import type { Conn } from "./room";

const mk = (): Conn => ({ send: () => {}, close: () => {} });

describe("RoomManager", () => {
  it("gera códigos válidos e únicos", () => {
    const m = new RoomManager({ maxRooms: 1000, maxRoomsPerIp: 1000 });
    const codes = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const r = m.create("1.1.1.1", "a", mk(), 0);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.room.code).toMatch(ROOM_CODE_RE);
        expect(r.room.code).not.toMatch(/[0OIL1]/);
        expect(r.seat).toBe(0);
        codes.add(r.room.code);
      }
    }
    expect(codes.size).toBe(200);
  });

  it("limita salas por IP e global", () => {
    const m = new RoomManager();
    for (let i = 0; i < 3; i++) expect(m.create("a", "n", mk(), 0).ok).toBe(true);
    expect(m.create("a", "n", mk(), 0)).toEqual({ ok: false, erro: "limite" });
    expect(m.create("b", "n", mk(), 0).ok).toBe(true);
    const g = new RoomManager({ maxRooms: 2, maxRoomsPerIp: 5 });
    g.create("a", "n", mk(), 0);
    g.create("b", "n", mk(), 0);
    expect(g.create("c", "n", mk(), 0)).toEqual({ ok: false, erro: "limite" });
  });

  it("limita tentativas de join por IP, mesmo com código inexistente", () => {
    const m = new RoomManager();
    for (let i = 0; i < 10; i++) expect(m.join("x", "ABCDEF", "n", mk(), 1000)).toEqual({ ok: false, erro: "sala_inexistente" });
    expect(m.join("x", "ABCDEF", "n", mk(), 1000)).toEqual({ ok: false, erro: "tente_depois" });
    expect(m.join("y", "ABCDEF", "n", mk(), 1000)).toEqual({ ok: false, erro: "sala_inexistente" });
    expect(m.join("x", "ABCDEF", "n", mk(), 61_001)).toEqual({ ok: false, erro: "sala_inexistente" });
  });

  it("reconnect também conta na janela", () => {
    const m = new RoomManager({ maxAttemptsPerMin: 2 });
    const tok = "0".repeat(32);
    expect(m.reconnect("x", "ABCDEF", tok, mk(), 0)).toEqual({ ok: false, erro: "sala_inexistente" });
    expect(m.join("x", "ABCDEF", "n", mk(), 0)).toEqual({ ok: false, erro: "sala_inexistente" });
    expect(m.reconnect("x", "ABCDEF", tok, mk(), 0)).toEqual({ ok: false, erro: "tente_depois" });
  });

  it("código malformado é sala_inexistente", () => {
    const m = new RoomManager();
    expect(m.join("x", "abc", "n", mk(), 0)).toEqual({ ok: false, erro: "sala_inexistente" });
    expect(m.join("x", 5 as unknown as string, "n", mk(), 0)).toEqual({ ok: false, erro: "sala_inexistente" });
  });

  it("sala cheia e token inválido", () => {
    const m = new RoomManager();
    const c = m.create("a", "n", mk(), 0);
    if (!c.ok) throw new Error("x");
    const code = c.room.code;
    const j = m.join("b", code, "m", mk(), 1);
    expect(j.ok && j.seat).toBe(1);
    expect(m.join("c", code, "k", mk(), 2)).toEqual({ ok: false, erro: "sala_cheia" });
    expect(m.reconnect("a", code, "f".repeat(32), mk(), 3)).toEqual({ ok: false, erro: "token_invalido" });
    const r = m.reconnect("a", code, c.token, mk(), 4);
    expect(r.ok && r.seat).toBe(0);
  });

  it("Review Focus 3: sala morta é removida e IP liberado", () => {
    const m = new RoomManager();
    const c1 = mk();
    const c2 = mk();
    const a = m.create("ip", "a", c1, 0);
    if (!a.ok) throw new Error("x");
    const b = m.join("ip2", a.room.code, "b", c2, 0);
    expect(b.ok).toBe(true);
    a.room.disconnect(0, c1, 0);
    a.room.disconnect(1, c2, 0);
    m.create("ip", "a", mk(), 0);
    m.create("ip", "a", mk(), 0);
    expect(m.size).toBe(3);
    m.tick(60_001, 33);
    expect(m.size).toBe(2);
    expect(m.get(a.room.code)).toBeUndefined();
    expect(m.create("ip", "a", mk(), 60_002).ok).toBe(true);
    expect(m.create("ip", "a", mk(), 60_002)).toEqual({ ok: false, erro: "limite" });
  });

  it("tick remove salas mortas e libera cota do IP até o limite", () => {
    const m = new RoomManager();
    const cs = [mk(), mk(), mk()];
    const rs = cs.map((c) => m.create("ip", "a", c, 0));
    rs.forEach((r, i) => r.ok && r.room.disconnect(0, cs[i], 0));
    m.tick(60_001, 33);
    expect(m.size).toBe(0);
    for (let i = 0; i < 3; i++) expect(m.create("ip", "a", mk(), 60_002).ok).toBe(true);
    expect(m.create("ip", "a", mk(), 60_002).ok).toBe(false);
  });
});
