import { describe, expect, it } from "vitest";
import { GRACE_MS, IDLE_TTL_MS, Room, type Conn } from "./room";
import type { ServerMsg } from "@/online/protocol";

type Fake = Conn & { msgs: ServerMsg[]; closed: number };
const fake = (): Fake => {
  const c: Fake = {
    msgs: [],
    closed: 0,
    send(m) {
      c.msgs.push(m);
    },
    close() {
      c.closed++;
    },
  };
  return c;
};
const estados = (c: Fake) => c.msgs.filter((m) => m.t === "estado") as Extract<ServerMsg, { t: "estado" }>[];

function full() {
  let n = 0;
  const room = new Room("ABC234", () => `tok${n++}`.padEnd(32, "0"));
  const a = fake();
  const b = fake();
  const ja = room.join("Ana", a, 0)!;
  const jb = room.join("Beto", b, 0)!;
  return { room, a, b, ja, jb };
}

describe("Room", () => {
  it("atribui assentos, recusa o 3º e não vaza tokens", () => {
    const { room, a, b, ja, jb } = full();
    expect(ja.seat).toBe(0);
    expect(jb.seat).toBe(1);
    expect(room.join("C", fake(), 0)).toBeNull();
    expect(JSON.stringify(b.msgs)).not.toContain(ja.token);
    expect(JSON.stringify(a.msgs)).not.toContain(jb.token);
    expect(JSON.stringify(a.msgs)).toContain(ja.token);
    expect(a.msgs.filter((m) => m.t === "sala").length).toBe(1);
    expect(b.msgs.map((m) => m.t)).toEqual(expect.arrayContaining(["sala", "assentos", "estado", "snapshot"]));
  });

  it("tacada com sala aguardando é ignorada sem mensagens", () => {
    const room = new Room("ABC234");
    const a = fake();
    room.join("Ana", a, 0);
    a.msgs.length = 0;
    room.handle(0, { t: "tacada", angulo: 0, forca: 0.8 }, 1);
    room.handle(0, { t: "revanche" }, 1);
    room.tick(10, 16);
    expect(a.msgs).toEqual([]);
  });

  it("tacada, snapshot no tick, estado ao assentar; fora de turno ignorada", () => {
    const { room, a, b } = full();
    a.msgs.length = b.msgs.length = 0;
    room.handle(1, { t: "tacada", angulo: 0, forca: 0.8 }, 1);
    expect(a.msgs).toEqual([]);
    room.handle(0, { t: "tacada", angulo: 0, forca: 0.8 }, 1);
    a.msgs.length = b.msgs.length = 0;
    room.tick(2, 16);
    expect(a.msgs.some((m) => m.t === "snapshot")).toBe(true);
    expect(b.msgs.some((m) => m.t === "snapshot")).toBe(true);
    let t = 2;
    for (let i = 0; i < 5000 && !["mira", "posicionando"].includes(estados(a).at(-1)?.fase ?? ""); i++) {
      t += 16;
      room.tick(t, 16);
    }
    expect(["mira", "posicionando"]).toContain(estados(a).at(-1)!.fase);
  });

  it("mira do jogador da vez é repassada só ao oponente, com valores saneados", () => {
    const { room, a, b } = full();
    a.msgs.length = b.msgs.length = 0;
    room.handle(0, { t: "mirar", angulo: 7, forca: 5 }, 1);
    expect(a.msgs).toEqual([]);
    const m = b.msgs[0] as Extract<ServerMsg, { t: "mira" }>;
    expect(m.t).toBe("mira");
    expect(m.forca).toBe(1);
    expect(m.angulo).toBeCloseTo(7 - 2 * Math.PI);
  });

  it("mira fora de turno, em fase errada ou posição da branca fora de fase é ignorada", () => {
    const { room, a, b } = full();
    a.msgs.length = b.msgs.length = 0;
    room.handle(1, { t: "mirar", angulo: 0, forca: 0.5 }, 1); // não é a vez
    room.handle(0, { t: "mover_branca", x: 1, y: 1 }, 1); // fase é "mira", não "posicionando"
    expect(a.msgs).toEqual([]);
    expect(b.msgs).toEqual([]);
    room.handle(0, { t: "tacada", angulo: 0, forca: 0.8 }, 1); // agora rolando
    a.msgs.length = b.msgs.length = 0;
    room.handle(0, { t: "mirar", angulo: 0, forca: 0.5 }, 2);
    expect(b.msgs).toEqual([]);
  });

  it("reconexão com conexão antiga aberta: fecha a antiga, obsoleta é ignorada", () => {
    const { room, a, b, ja, jb } = full();
    const nova = fake();
    expect(room.reconnect("x".repeat(32), nova, 5)).toBeNull();
    expect(room.reconnect(ja.token, nova, 5)).toBe(0);
    expect(a.closed).toBe(1);
    expect(nova.msgs.map((m) => m.t)).toEqual(expect.arrayContaining(["sala", "assentos", "estado", "snapshot"]));
    const aLen = a.msgs.length;
    room.disconnect(0, a, 6);
    nova.msgs.length = 0;
    b.msgs.length = 0;
    room.tick(6 + GRACE_MS + 10, 16);
    expect(estados(b).some((e) => e.vencedor !== null)).toBe(false);
    expect(estados(nova).some((e) => e.vencedor !== null)).toBe(false);
    // novo broadcast mostra assento 0 ainda conectado e vai só para a nova conexão
    const b2 = fake();
    room.reconnect(jb.token, b2, 7);
    const ass = b2.msgs.filter((m) => m.t === "assentos").at(-1) as Extract<ServerMsg, { t: "assentos" }>;
    expect(ass.assentos[0]?.conectado).toBe(true);
    expect(nova.msgs.some((m) => m.t === "assentos")).toBe(true);
    expect(a.msgs.length).toBe(aLen);
  });

  it("W.O. após a carência e cancelamento por reconexão", () => {
    const { room, a, jb, b } = full();
    room.disconnect(1, b, 0);
    room.tick(59_999, 16);
    expect(estados(a).at(-1)!.vencedor).toBeNull();
    room.tick(60_001, 16);
    const e = estados(a).at(-1)!;
    expect(e.vencedor).toBe(0);
    expect(e.mensagem).toContain("W.O.");

    const g = full();
    g.room.disconnect(1, g.b, 0);
    expect(g.room.reconnect(g.jb.token, fake(), 30_000)).toBe(1);
    g.room.tick(60_001, 16);
    g.room.tick(100_000, 16);
    expect(estados(g.a).at(-1)!.vencedor).toBeNull();
    void jb;
  });

  it("vencedor que desconecta depois do fim não inverte o resultado", () => {
    const { room, a, b, ja } = full();
    room.disconnect(1, b, 0);
    room.tick(60_001, 16);
    const n = a.msgs.length;
    room.disconnect(0, a, 61_000);
    room.tick(200_000, 16);
    expect(a.msgs.length).toBe(n);
    const a2 = fake();
    expect(room.reconnect(ja.token, a2, 201_000)).toBe(0);
    expect(estados(a2).at(-1)!.vencedor).toBe(0);
  });

  it("reconectar após sair devolve null", () => {
    const { room, ja } = full();
    const a = fake();
    room.disconnect(0, a, 0);
    const g = full();
    g.room.handle(0, { t: "sair" }, 1);
    expect(g.room.reconnect(g.ja.token, fake(), 2)).toBeNull();
    void room; void ja;
  });

  it("join recusado quando o criador saiu ou sumiu além da carência", () => {
    const r1 = new Room("ABC234");
    r1.join("Ana", fake(), 0);
    r1.handle(0, { t: "sair" }, 1);
    expect(r1.join("Beto", fake(), 2)).toBeNull();

    const c2 = fake();
    const r2 = new Room("ABC234");
    r2.join("Ana", c2, 0);
    r2.disconnect(0, c2, 0);
    expect(r2.join("Beto", fake(), 60_001)).toBeNull();

    const c3 = fake();
    const r3 = new Room("ABC234");
    r3.join("Ana", c3, 0);
    r3.disconnect(0, c3, 0);
    expect(r3.join("Beto", fake(), 1_000)).not.toBeNull();
  });

  it("conn que lança em send não impede o outro assento", () => {
    const { room, a, b } = full();
    a.send = () => {
      throw new Error("morta");
    };
    b.msgs.length = 0;
    room.handle(0, { t: "tacada", angulo: 0, forca: 0.8 }, 1);
    expect(estados(b).at(-1)!.fase).toBe("rolando");
  });

  it("token não-string em reconnect devolve null", () => {
    const { room } = full();
    expect(room.reconnect(123 as unknown as string, fake(), 1)).toBeNull();
    expect(room.reconnect(undefined as unknown as string, fake(), 1)).toBeNull();
  });

  it("rematch pendente é limpo quando o assento desconecta", () => {
    const { room, a, b, jb } = full();
    room.disconnect(1, b, 0);
    room.tick(60_001, 16); // fim
    room.handle(1, { t: "revanche" }, 60_002); // sem conn, mas pedido
    room.disconnect(1, b, 60_003); // conn obsoleta (já null): ignorada
    const b2 = fake();
    room.reconnect(jb.token, b2, 60_004);
    room.handle(1, { t: "revanche" }, 60_005);
    room.disconnect(1, b2, 60_006);
    const n = estados(a).length;
    room.handle(0, { t: "revanche" }, 60_007);
    expect(estados(a).length).toBe(n);
  });

  it("revanche exige os dois e só em fim", () => {
    const { room, a, b } = full();
    room.handle(0, { t: "revanche" }, 1);
    room.handle(1, { t: "revanche" }, 1);
    expect(estados(a).length).toBe(1);
    room.handle(1, { t: "sair" }, 2);
    expect(estados(a).at(-1)!.vencedor).toBe(0);
    const c = full();
    c.room.disconnect(1, c.b, 0);
    c.room.tick(60_001, 16); // W.O. -> fim
    const b2 = fake();
    c.room.reconnect(c.jb.token, b2, 61_000);
    c.b = b2;
    c.room.handle(0, { t: "revanche" }, 62_000);
    c.room.handle(1, { t: "revanche" }, 62_000);
    const e = estados(c.b).at(-1)!;
    expect(e.fase).toBe("mira");
    expect(e.vencedor).toBeNull();
    const snap = c.b.msgs.filter((m) => m.t === "snapshot").at(-1) as Extract<ServerMsg, { t: "snapshot" }>;
    expect(snap.bolas.length).toBe(16);
    void b;
  });

  it("revanche com apenas um pedido não reinicia", () => {
    const { room, a, b } = full();
    room.handle(1, { t: "sair" }, 2);
    const n = estados(a).length;
    room.handle(0, { t: "revanche" }, 3);
    expect(estados(a).length).toBe(n);
    void b;
  });

  it("isDead por ausência e por inatividade", () => {
    const { room, a, b } = full();
    room.disconnect(0, a, 100);
    room.disconnect(1, b, 100);
    expect(room.isDead(100 + GRACE_MS)).toBe(false);
    expect(room.isDead(100 + GRACE_MS + 1)).toBe(true);
    const r = full();
    expect(r.room.isDead(IDLE_TTL_MS)).toBe(false);
    expect(r.room.isDead(IDLE_TTL_MS + 1)).toBe(true);
  });
});
