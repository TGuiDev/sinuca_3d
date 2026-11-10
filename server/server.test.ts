import { afterEach, beforeEach, describe, expect, it } from "vitest";
import net from "node:net";
import WebSocket from "ws";
import { startServer } from "./index";

const ORIGIN = "http://test.local";
type Srv = Awaited<ReturnType<typeof startServer>>;
type Msg = Record<string, unknown>;

class Client {
  msgs: Msg[] = [];
  closeCode: number | null = null;
  ws: WebSocket;
  private waiters: (() => void)[] = [];
  constructor(port: number) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/socket`, { headers: { Origin: ORIGIN } });
    this.ws.on("message", (d) => {
      this.msgs.push(JSON.parse(d.toString()));
      this.waiters.forEach((w) => w());
    });
    this.ws.on("close", (c) => {
      this.closeCode = c;
      this.waiters.forEach((w) => w());
    });
    this.ws.on("error", () => {});
  }
  open() {
    return new Promise<void>((res, rej) => {
      this.ws.once("open", () => res());
      this.ws.once("error", rej);
    });
  }
  send(o: unknown) {
    this.ws.send(typeof o === "string" ? o : JSON.stringify(o));
  }
  waitFor(pred: (m: Msg) => boolean, ms = 3000): Promise<Msg> {
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error("timeout waitFor")), ms);
      const check = () => {
        const m = this.msgs.find(pred);
        if (m) {
          clearTimeout(t);
          this.waiters = this.waiters.filter((w) => w !== check);
          res(m);
        }
      };
      this.waiters.push(check);
      check();
    });
  }
  waitClose(ms = 3000): Promise<number> {
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error("timeout close")), ms);
      const check = () => {
        if (this.closeCode !== null) {
          clearTimeout(t);
          res(this.closeCode);
        }
      };
      this.waiters.push(check);
      check();
    });
  }
}

let srv: Srv;
let clients: Client[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const connect = async () => {
  const c = new Client(srv.port);
  clients.push(c);
  await c.open();
  return c;
};
const pair = async () => {
  const a = await connect();
  a.send({ t: "criar_sala", apelido: "Ana" });
  const sala = await a.waitFor((m) => m.t === "sala");
  const b = await connect();
  b.send({ t: "entrar_sala", codigo: sala.codigo, apelido: "Beto" });
  await b.waitFor((m) => m.t === "sala");
  await a.waitFor((m) => m.t === "estado");
  await b.waitFor((m) => m.t === "estado");
  return { a, b, sala };
};

beforeEach(async () => {
  srv = await startServer({ port: 0, allowedOrigin: ORIGIN, tickMs: 10 });
});
afterEach(async () => {
  for (const c of clients) c.ws.terminate();
  clients = [];
  await srv.close();
});

describe("servidor WebSocket", () => {
  it("rotas HTTP", async () => {
    const base = `http://127.0.0.1:${srv.port}`;
    const h = await fetch(`${base}/health`);
    expect(h.status).toBe(200);
    expect(await h.text()).toBe("ok");
    expect((await fetch(`${base}/socket/health`)).status).toBe(200);
    expect((await fetch(`${base}/x`)).status).toBe(404);
  });

  it("recusa origem errada, ausente e caminho errado", async () => {
    const status = (url: string, headers: Record<string, string>) =>
      new Promise<number>((res) => {
        const ws = new WebSocket(url, { headers });
        ws.on("unexpected-response", (_rq, rs) => {
          res(rs.statusCode ?? 0);
          rs.resume();
        });
        ws.on("error", () => {});
      });
    const u = `ws://127.0.0.1:${srv.port}`;
    expect(await status(`${u}/socket`, { Origin: "http://evil.local" })).toBe(403);
    expect(await status(`${u}/socket`, {})).toBe(403);
    expect(await status(`${u}/outro`, { Origin: ORIGIN })).toBe(404);
  });

  it("cria e entra em sala", async () => {
    const { a, b } = await pair();
    const sa = a.msgs.find((m) => m.t === "sala")!;
    const sb = b.msgs.find((m) => m.t === "sala")!;
    expect(sa.voce).toBe(0);
    expect(sb.voce).toBe(1);
    for (const c of [a, b]) {
      const e = c.msgs.find((m) => m.t === "estado")!;
      expect(e.fase).toBe("mira");
      expect(e.turno).toBe(0);
    }
  });

  it("tacada fora de turno é ignorada; tacada válida rola e assenta", async () => {
    const { a, b } = await pair();
    const n = a.msgs.filter((m) => m.t === "snapshot").length;
    b.send({ t: "tacada", angulo: 0.1, forca: 0.8 });
    await sleep(300);
    expect(a.msgs.filter((m) => m.t === "snapshot").length).toBe(n);
    a.send({ t: "tacada", angulo: 0.1, forca: 0.8 });
    for (const c of [a, b]) {
      await c.waitFor((m) => m.t === "estado" && m.fase === "rolando");
      await c.waitFor((m) => m.t === "snapshot");
    }
    const fim = (m: Msg) => m.t === "estado" && (m.fase === "mira" || m.fase === "posicionando");
    const idx = a.msgs.findIndex((m) => m.t === "estado" && m.fase === "rolando");
    await a.waitFor((m) => fim(m) && a.msgs.indexOf(m) > idx, 20000);
  }, 25000);

  it("mensagem grande derruba com 1009; inválida devolve erro", async () => {
    const a = await connect();
    a.send({ t: "criar_sala", apelido: "x".repeat(2000) });
    expect(await a.waitClose()).toBe(1009);
    const b = await connect();
    b.send('{"t":"x"}');
    expect(await b.waitFor((m) => m.t === "erro")).toEqual({ t: "erro", codigo: "mensagem_invalida" });
  });

  it("5 mensagens inválidas fecham com 1008; binário conta como inválido", async () => {
    const a = await connect();
    a.ws.send(Buffer.from([1, 2, 3]));
    await a.waitFor((m) => m.t === "erro");
    for (let i = 0; i < 4; i++) a.send("lixo");
    expect(await a.waitClose()).toBe(1008);
  });

  it("flood estoura o balde e fecha com 1008", async () => {
    const a = await connect();
    for (let i = 0; i < 60; i++) a.send({ t: "revanche" });
    expect(await a.waitClose()).toBe(1008);
  });

  it("mensagens fora de sequência dão erro e mantêm a conexão", async () => {
    const a = await connect();
    a.send({ t: "tacada", angulo: 0.1, forca: 0.5 });
    await a.waitFor((m) => m.t === "erro");
    a.send({ t: "criar_sala", apelido: "Ana" });
    await a.waitFor((m) => m.t === "sala");
    a.send({ t: "criar_sala", apelido: "Ana" });
    await a.waitFor((m) => m.t === "erro" && a.msgs.filter((x) => x.t === "sala").length === 1 && a.msgs.length >= 3);
    expect(a.closeCode).toBeNull();
  });

  it("erro do manager mantém o socket aberto", async () => {
    const a = await connect();
    a.send({ t: "entrar_sala", codigo: "ABCDEF", apelido: "Ana" });
    expect(await a.waitFor((m) => m.t === "erro")).toEqual({ t: "erro", codigo: "sala_inexistente" });
    expect(a.closeCode).toBeNull();
  });

  it("reconectar assume o assento e a conexão antiga é descartada", async () => {
    const { a, b, sala } = await pair();
    const a2 = await connect();
    a2.send({ t: "reconectar", codigo: sala.codigo, token: sala.token });
    const s2 = await a2.waitFor((m) => m.t === "sala");
    expect(s2.voce).toBe(0);
    // socket antigo ainda aberto do lado do servidor/cliente em fechamento: injeta um frame cru "sair"
    const payload = Buffer.from('{"t":"sair"}');
    const key = Buffer.from([1, 2, 3, 4]);
    const masked = Buffer.from(payload.map((x, i) => x ^ key[i % 4]));
    const frame = [Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), key, masked])];
    const raw = (a.ws as unknown as { _socket: net.Socket })._socket;
    for (const f of frame) raw.write(f);
    await sleep(300);
    expect(b.msgs.some((m) => m.t === "estado" && m.fase === "fim")).toBe(false);
    expect(a2.msgs.some((m) => m.t === "estado" && m.fase === "fim")).toBe(false);
  });

  it("sair dá W.O. ao oponente", async () => {
    const { a, b } = await pair();
    b.send({ t: "sair" });
    const e = await a.waitFor((m) => m.t === "estado" && m.fase === "fim");
    expect(e.vencedor).toBe(0);
  });

  it("limita conexões por IP", async () => {
    for (let i = 0; i < 10; i++) await connect();
    const extra = new Client(srv.port);
    clients.push(extra);
    const r = await new Promise<string>((res) => {
      extra.ws.on("open", () => res("open"));
      extra.ws.on("unexpected-response", (_q, rs) => {
        res(String(rs.statusCode));
        rs.resume();
      });
    });
    expect(r).toBe("429");
  });

  it("upgrades malformados não vazam vagas do limite por IP", async () => {
    const bad = () =>
      new Promise<void>((res) => {
        const sock = net.connect(srv.port, "127.0.0.1", () => {
          sock.write(
            `GET /socket HTTP/1.1\r\nHost: x\r\nOrigin: ${ORIGIN}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n`,
          );
        });
        sock.on("error", () => {});
        sock.on("close", () => res());
        sock.resume();
      });
    for (let i = 0; i < 12; i++) await bad();
    await sleep(100);
    const c = await connect();
    expect(c.ws.readyState).toBe(WebSocket.OPEN);
  });

  it("vaga por IP é liberada ao fechar uma conexão", async () => {
    const cs: Client[] = [];
    for (let i = 0; i < 10; i++) cs.push(await connect());
    const tryOne = () =>
      new Promise<string>((res) => {
        const x = new Client(srv.port);
        clients.push(x);
        x.ws.on("open", () => res("open"));
        x.ws.on("unexpected-response", (_q, rs) => {
          res(String(rs.statusCode));
          rs.resume();
        });
      });
    expect(await tryOne()).toBe("429");
    cs[0].ws.close();
    await cs[0].waitClose();
    await sleep(100);
    expect(await tryOne()).toBe("open");
  });

  it("após fechamento por abuso, mensagens seguintes não são processadas", async () => {
    const { a, b } = await pair();
    for (let i = 0; i < 5; i++) a.send("lixo");
    a.send({ t: "sair" });
    await sleep(300);
    expect(b.msgs.some((m) => m.t === "estado" && m.fase === "fim")).toBe(false);
    expect(await a.waitClose()).toBeTruthy();
  });
});
