import type { ClientMsg, ServerMsg } from "./protocol";

export type NetStatus = "conectando" | "online" | "reconectando" | "encerrada";

export type SocketLike = {
  send(d: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((e: { data: string }) => void) | null;
  onclose: (() => void) | null;
};

const DEFAULT_BACKOFF = [500, 1000, 2000, 4000, 8000];
/** Orcamento total de espera entre tentativas (casa com a graca de 60 s do servidor). */
const BUDGET_MS = 60000;
/** Conexao aberta por pelo menos isto zera o backoff. */
const STABLE_MS = 10000;
/** Frames maiores que isto sao ignorados (o servidor nunca envia algo assim). */
const MAX_FRAME_CHARS = 64 * 1024;

/**
 * Apos uma reconexao, so estas mensagens enfileiradas sao reenviadas.
 * criar_sala/entrar_sala criariam/ocupariam um segundo assento; tacada e
 * posicionar_branca ficam obsoletas (o estado do jogo pode ter mudado);
 * reconectar e enviado automaticamente pelo cliente, nunca duplicado.
 */
const REPLAYABLE_AFTER_RECONNECT: ReadonlySet<ClientMsg["t"]> = new Set(["revanche", "sair"]);

function defaultMakeSocket(url: string): SocketLike {
  if (typeof WebSocket === "undefined") throw new Error("WebSocket indisponivel");
  return new WebSocket(url) as unknown as SocketLike;
}

export class RoomClient {
  private readonly url: string;
  private readonly makeSocket: (url: string) => SocketLike;
  private readonly onMessage: (m: ServerMsg) => void;
  private readonly onStatus: (s: NetStatus) => void;
  private readonly backoff: number[];
  private sock: SocketLike | null = null;
  private queue: ClientMsg[] = [];
  private creds: { codigo: string; token: string } | null = null;
  private status: NetStatus | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private spent = 0;
  private hadOpen = false;
  private openedAt: number | null = null;
  private ended = false;

  constructor(opts: {
    url: string;
    makeSocket?: (url: string) => SocketLike;
    onMessage: (m: ServerMsg) => void;
    onStatus: (s: NetStatus) => void;
    backoffMs?: number[];
  }) {
    this.url = opts.url;
    this.makeSocket = opts.makeSocket ?? defaultMakeSocket;
    this.onMessage = opts.onMessage;
    this.onStatus = opts.onStatus;
    this.backoff = opts.backoffMs && opts.backoffMs.length > 0 ? opts.backoffMs : DEFAULT_BACKOFF;
    this.setStatus("conectando");
    this.connect();
  }

  send(msg: ClientMsg): void {
    if (this.ended) return;
    if (this.sock && this.status === "online") this.sock.send(JSON.stringify(msg));
    else this.queue.push(msg);
  }

  setCredentials(codigo: string, token: string): void {
    this.creds = { codigo, token };
  }

  close(): void {
    this.finish();
  }

  private setStatus(s: NetStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.onStatus(s);
  }

  private finish(): void {
    this.ended = true;
    this.clearTimer();
    this.queue = [];
    this.creds = null;
    const s = this.sock;
    this.sock = null;
    if (s) {
      s.onopen = null;
      s.onmessage = null;
      s.onclose = null;
      try {
        s.close();
      } catch {
        /* ignorado */
      }
    }
    this.setStatus("encerrada");
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private connect(): void {
    let s: SocketLike;
    try {
      s = this.makeSocket(this.url);
    } catch {
      this.finish();
      return;
    }
    this.sock = s;
    s.onopen = () => {
      if (this.sock !== s || this.ended) return;
      const reconnect = this.hadOpen;
      this.hadOpen = true;
      this.openedAt = Date.now();
      this.setStatus("online");
      let pending = this.queue;
      this.queue = [];
      if (reconnect) {
        pending = pending.filter((m) => REPLAYABLE_AFTER_RECONNECT.has(m.t));
        if (this.creds) {
          s.send(JSON.stringify({ t: "reconectar", codigo: this.creds.codigo, token: this.creds.token }));
        }
      }
      for (const m of pending) s.send(JSON.stringify(m));
    };
    s.onmessage = (e) => {
      if (this.sock !== s || this.ended) return;
      const m = parseFrame(e.data);
      if (!m) return;
      this.onMessage(m);
      if (m.t === "erro" && (m.codigo === "token_invalido" || m.codigo === "sala_inexistente")) {
        this.finish();
      }
    };
    s.onclose = () => {
      if (this.sock !== s || this.ended) return;
      this.sock = null;
      // So zera o backoff se a conexao ficou estavel; evita laco rapido de abre/cai.
      if (this.openedAt !== null && Date.now() - this.openedAt >= STABLE_MS) {
        this.attempt = 0;
        this.spent = 0;
      }
      this.openedAt = null;
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    // Depois de ter estado online sem credenciais nao ha como reassumir o assento.
    if (this.hadOpen && !this.creds) return this.finish();
    const delay = this.backoff[Math.min(this.attempt, this.backoff.length - 1)];
    if (this.spent + delay > BUDGET_MS) return this.finish();
    this.attempt++;
    this.spent += delay;
    this.setStatus("reconectando");
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.ended) this.connect();
    }, delay);
  }
}

function parseFrame(data: unknown): ServerMsg | null {
  if (typeof data !== "string" || data.length > MAX_FRAME_CHARS) return null;
  let v: unknown;
  try {
    v = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  if (typeof (v as { t?: unknown }).t !== "string") return null;
  return v as ServerMsg;
}
