import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoomClient, type NetStatus, type SocketLike } from "./net";
import type { ServerMsg } from "./protocol";

class FakeSocket implements SocketLike {
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.onopen?.();
  }
  recv(data: string) {
    this.onmessage?.({ data });
  }
  drop() {
    this.onclose?.();
  }
}

function setup(backoffMs?: number[]) {
  const sockets: FakeSocket[] = [];
  const msgs: ServerMsg[] = [];
  const statuses: NetStatus[] = [];
  const client = new RoomClient({
    url: "ws://x",
    makeSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    onMessage: (m) => msgs.push(m),
    onStatus: (s) => statuses.push(s),
    backoffMs,
  });
  return { sockets, msgs, statuses, client };
}

describe("RoomClient", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("enfileira mensagens e envia ao abrir", () => {
    const { sockets, statuses, client } = setup();
    client.send({ t: "criar_sala", apelido: "a" });
    expect(sockets[0].sent).toEqual([]);
    expect(statuses).toEqual(["conectando"]);
    sockets[0].open();
    expect(sockets[0].sent).toEqual([JSON.stringify({ t: "criar_sala", apelido: "a" })]);
    expect(statuses).toEqual(["conectando", "online"]);
    client.send({ t: "revanche" });
    expect(sockets[0].sent).toHaveLength(2);
  });

  it("entrega JSON valido e ignora lixo", () => {
    const { sockets, msgs, client } = setup();
    sockets[0].open();
    sockets[0].recv("nao json");
    sockets[0].recv("123");
    sockets[0].recv("null");
    sockets[0].recv('{"t":5}');
    sockets[0].recv('{"x":1}');
    sockets[0].recv('["t"]');
    sockets[0].recv(JSON.stringify({ t: "x".repeat(70000) }));
    sockets[0].onmessage?.({ data: 42 as unknown as string });
    expect(msgs).toEqual([]);
    sockets[0].recv('{"t":"assentos","assentos":[null,null]}');
    expect(msgs).toHaveLength(1);
    client.close();
  });

  it("reconecta apos 500 ms e envia reconectar; 2a queda espera 1000 ms", () => {
    const { sockets, statuses, client } = setup();
    client.setCredentials("ABCDEF", "a".repeat(32));
    sockets[0].open();
    sockets[0].drop();
    expect(statuses.at(-1)).toBe("reconectando");
    vi.advanceTimersByTime(499);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    sockets[1].open();
    expect(sockets[1].sent).toEqual([
      JSON.stringify({ t: "reconectar", codigo: "ABCDEF", token: "a".repeat(32) }),
    ]);
    expect(statuses.at(-1)).toBe("online");
    sockets[1].drop();
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);
    client.close();
  });

  it("conexao estavel zera o backoff", () => {
    const { sockets, client } = setup();
    client.setCredentials("ABCDEF", "e".repeat(32));
    sockets[0].open();
    sockets[0].drop();
    vi.advanceTimersByTime(500);
    sockets[1].open();
    vi.advanceTimersByTime(10000);
    sockets[1].drop();
    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(3);
    client.close();
  });

  it("apos reconexao descarta mensagens nao reenviaveis e envia no maximo uma vez", () => {
    const { sockets, client } = setup();
    client.setCredentials("ABCDEF", "b".repeat(32));
    sockets[0].open();
    sockets[0].drop();
    client.send({ t: "entrar_sala", codigo: "ZZZZZZ", apelido: "x" });
    client.send({ t: "criar_sala", apelido: "x" });
    client.send({ t: "tacada", angulo: 1, forca: 1 });
    client.send({ t: "revanche" });
    vi.advanceTimersByTime(500);
    sockets[1].open();
    expect(sockets[1].sent.map((s) => JSON.parse(s).t)).toEqual(["reconectar", "revanche"]);
    client.close();
  });

  it("token_invalido encerra sem novas tentativas", () => {
    const { sockets, msgs, statuses, client } = setup();
    client.setCredentials("ABCDEF", "c".repeat(32));
    sockets[0].open();
    sockets[0].drop();
    vi.advanceTimersByTime(500);
    sockets[1].open();
    sockets[1].recv('{"t":"erro","codigo":"token_invalido"}');
    expect(msgs).toHaveLength(1);
    expect(statuses.at(-1)).toBe("encerrada");
    sockets[1].drop();
    vi.advanceTimersByTime(120000);
    expect(sockets).toHaveLength(2);
  });

  it("sala_inexistente tambem encerra", () => {
    const { sockets, statuses } = setup();
    sockets[0].open();
    sockets[0].recv('{"t":"erro","codigo":"sala_inexistente"}');
    expect(statuses.at(-1)).toBe("encerrada");
  });

  it("close() nao reconecta e limpa timers", () => {
    const { sockets, statuses, client } = setup();
    client.setCredentials("ABCDEF", "d".repeat(32));
    sockets[0].open();
    sockets[0].drop();
    client.close();
    vi.advanceTimersByTime(120000);
    expect(sockets).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(statuses.at(-1)).toBe("encerrada");
    client.send({ t: "revanche" });
    expect(sockets).toHaveLength(1);
  });

  it("esgota o orcamento de ~60 s e encerra", () => {
    const { sockets, statuses } = setup();
    sockets[0].open();
    // sem credenciais apos queda ja encerra; com falhas de conexao inicial tenta ate o orcamento
    const s = setup();
    s.sockets[0].drop();
    for (let i = 0; i < 40 && s.statuses.at(-1) !== "encerrada"; i++) {
      vi.advanceTimersByTime(8000);
      s.sockets.at(-1)?.drop();
    }
    expect(s.statuses.at(-1)).toBe("encerrada");
    expect(vi.getTimerCount()).toBe(0);
    expect(statuses.at(-1)).toBe("online");
    expect(sockets).toHaveLength(1);
  });

  it("queda sem credenciais depois de online encerra", () => {
    const { sockets, statuses } = setup();
    sockets[0].open();
    sockets[0].drop();
    expect(statuses.at(-1)).toBe("encerrada");
  });
});
