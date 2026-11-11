import { isIP } from "node:net";
import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, WebSocket } from "ws";
import type { RawData } from "ws";
import { MAX_MESSAGE_BYTES } from "../src/online/protocol";
import type { ServerMsg } from "../src/online/protocol";
import { TokenBucket } from "./limits";
import { RoomManager } from "./rooms";
import type { Result } from "./rooms";
import type { Room, Conn } from "./room";
import { parseClientMessage } from "./validate";

const MAX_CONN_PER_IP = 10;
const MAX_INVALID = 5;
const HEARTBEAT_MS = 15_000;

/** Relógio monotônico em ms inteiros (limitadores e podas assumem tempo não decrescente). */
const clock = (): number => Math.floor(performance.now());

/**
 * IP do cliente: `CF-Connecting-IP` (primeiro valor) ou o endereço do socket.
 * Só é confiável porque o servidor é acessível apenas atrás do Traefik/Cloudflare
 * (nenhuma porta publicada no host); expostos direto, o cabeçalho seria forjável.
 */
function clientIp(req: IncomingMessage): string {
  const h = req.headers["cf-connecting-ip"];
  const raw = Array.isArray(h) ? h[0] : h;
  const first = raw?.split(",")[0]?.trim();
  if (first && isIP(first) !== 0) return first;
  return req.socket.remoteAddress || "unknown";
}

function reject(socket: Duplex, status: 403 | 404 | 429, reason: string): void {
  try {
    socket.write(
      `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    );
  } catch {
    /* socket já morto */
  }
  socket.destroy();
}

type Wrapper = Conn & { alive: boolean };

export async function startServer(opts: {
  port: number;
  allowedOrigin: string;
  tickMs?: number;
}): Promise<{ port: number; close(): Promise<void> }> {
  const manager = new RoomManager();
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const perIp = new Map<string, number>();
  const live = new Map<WebSocket, { isAlive: boolean }>();

  const http = createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0];
    if (req.method === "GET" && (path === "/health" || path === "/socket/health")) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
    }
  });

  http.on("upgrade", (req, socket, head) => {
    socket.on("error", () => {});
    try {
      const path = (req.url ?? "").split("?")[0];
      if (path !== "/socket") return reject(socket, 404, "Not Found");
      if (req.headers.origin !== opts.allowedOrigin) return reject(socket, 403, "Forbidden");
      const ip = clientIp(req);
      // Teto de conexões por IP: recusa o upgrade com 429 (em vez de aceitar e fechar com 1008).
      if ((perIp.get(ip) ?? 0) >= MAX_CONN_PER_IP) return reject(socket, 429, "Too Many Requests");
      perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
      // A vaga vive tanto quanto o socket CRU: cobre handshake recusado pelo ws (400/405,
      // que não lança nem chama o callback), destroy precoce, terminate, erro e fechamento normal.
      socket.once("close", () => release(ip));
      try {
        wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, ip));
      } catch {
        socket.destroy();
      }
    } catch {
      socket.destroy();
    }
  });

  const release = (ip: string): void => {
    const n = (perIp.get(ip) ?? 0) - 1;
    if (n <= 0) perIp.delete(ip);
    else perIp.set(ip, n);
  };

  function onConnection(ws: WebSocket, ip: string): void {
    const bucket = new TokenBucket(20, 30);
    const hb = { isAlive: true };
    live.set(ws, hb);
    ws.on("pong", () => {
      hb.isAlive = true;
    });

    const conn: Wrapper = {
      alive: true,
      send(msg: ServerMsg) {
        if (!conn.alive || ws.readyState !== WebSocket.OPEN) return;
        try {
          ws.send(JSON.stringify(msg));
        } catch {
          /* ignorado */
        }
      },
      close() {
        conn.alive = false;
        try {
          ws.close();
        } catch {
          /* ignorado */
        }
      },
    };
    // Fechamento por abuso/erro: para de despachar imediatamente e derruba o socket de verdade
    // (ws.close sozinho deixaria o cliente enviando por até 30 s). O evento "close" ainda dispara
    // uma vez e chama room.disconnect.
    const kill = (code: number): void => {
      conn.alive = false;
      try {
        ws.close(code);
      } catch {
        /* ignorado */
      }
      try {
        ws.terminate();
      } catch {
        /* ignorado */
      }
    };
    const sendErro = (codigo: "mensagem_invalida" | Extract<Result, { ok: false }>["erro"]): void =>
      conn.send({ t: "erro", codigo });

    let binding: { room: Room; seat: 0 | 1 } | null = null;
    let invalid = 0;

    const bad = (): void => {
      sendErro("mensagem_invalida");
      if (++invalid >= MAX_INVALID) kill(1008);
    };

    ws.on("message", (data: RawData, isBinary: boolean) => {
      if (!conn.alive) return; // conexão substituída por reconexão: descartar
      try {
        const now = clock();
        if (!bucket.take(now)) return kill(1008);
        if (isBinary) return bad();
        const msg = parseClientMessage(data.toString());
        if (!msg) return bad();
        if (msg.t === "criar_sala" || msg.t === "entrar_sala" || msg.t === "reconectar") {
          if (binding) return sendErro("mensagem_invalida"); // já tem assento
          const r =
            msg.t === "criar_sala"
              ? manager.create(ip, msg.apelido, conn, now)
              : msg.t === "entrar_sala"
                ? manager.join(ip, msg.codigo, msg.apelido, conn, now)
                : manager.reconnect(ip, msg.codigo, msg.token, conn, now);
          if (r.ok) binding = { room: r.room, seat: r.seat };
          else sendErro(r.erro);
          return;
        }
        if (!binding) return sendErro("mensagem_invalida"); // ainda sem assento
        binding.room.handle(binding.seat, msg, now);
      } catch {
        kill(1011); // sem detalhes, nada enviado ao cliente
      }
    });

    ws.on("error", () => {
      /* ex.: payload grande (1009) — o ws fecha sozinho; nada a vazar */
    });

    ws.on("close", () => {
      live.delete(ws);
      conn.alive = false;
      try {
        // mesmo wrapper: a Room ignora desconexões de conexões obsoletas
        if (binding) binding.room.disconnect(binding.seat, conn, clock());
      } catch {
        /* ignorado */
      }
    });
  }

  let last = clock();
  const tick = setInterval(() => {
    try {
      const now = clock();
      const dt = now - last;
      last = now;
      manager.tick(now, dt);
    } catch {
      /* um erro de tick não derruba o processo */
    }
  }, opts.tickMs ?? 33);

  const heartbeat = setInterval(() => {
    try {
      for (const [ws, hb] of live) {
        if (!hb.isAlive) {
          ws.terminate();
          continue;
        }
        hb.isAlive = false;
        try {
          ws.ping();
        } catch {
          /* ignorado */
        }
      }
    } catch {
      /* um erro do heartbeat não derruba o processo */
    }
  }, HEARTBEAT_MS);

  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(opts.port, () => resolve());
  });
  // Erros posteriores do servidor de rede (ex.: EMFILE sob flood) não derrubam o processo.
  http.on("error", () => console.error("erro no servidor HTTP"));
  wss.on("error", () => console.error("erro no servidor WebSocket"));
  const addr = http.address();
  const port = typeof addr === "object" && addr ? addr.port : opts.port;

  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(tick);
        clearInterval(heartbeat);
        for (const ws of live.keys()) ws.terminate();
        wss.close();
        http.close(() => resolve());
        http.closeAllConnections();
      }),
  };
}
