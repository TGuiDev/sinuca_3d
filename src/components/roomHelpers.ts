import type { NetStatus, SocketLike } from "@/online/net";
import { ROOM_CODE_RE, type Assento, type ErroCodigo, type Fase } from "@/online/protocol";

export const APELIDO_KEY = "sinuca:apelido";
export const tokenKey = (codigo: string): string => `sinuca:token:${codigo}`;

/** Espelha a validação do servidor (que continua sendo a autoridade). */
export function cleanNickname(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const s = input
    .replace(/\s+/g, " ")
    .replace(/\p{C}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  const len = Array.from(s).length;
  if (len < 2 || len > 16) return null;
  return s;
}

export function normalizeRoomCode(input: string): string | null {
  const c = input.trim().toUpperCase();
  return ROOM_CODE_RE.test(c) ? c : null;
}

export type RoomParam = { kind: "nova" } | { kind: "codigo"; codigo: string } | { kind: "invalido" };

export function parseRoomParam(raw: string): RoomParam {
  if (raw === "nova") return { kind: "nova" };
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return { kind: "invalido" };
  }
  const codigo = normalizeRoomCode(decoded);
  return codigo ? { kind: "codigo", codigo } : { kind: "invalido" };
}

/** Nunca deriva o host de entrada do usuário: só de location. */
export function wsUrlFor(loc: { hostname: string; host: string }): string {
  if (loc.hostname === "localhost" || loc.hostname === "127.0.0.1") return "ws://localhost:8787/socket";
  return `wss://${loc.host}/socket`;
}

export const shareLink = (origin: string, codigo: string): string => `${origin}/sala/${codigo}`;

const ERROS: Record<ErroCodigo, string> = {
  sala_cheia: "Esta sala já está cheia.",
  sala_inexistente: "Esta sala não existe ou já foi encerrada.",
  limite: "Muitas salas abertas a partir da sua conexão. Tente mais tarde.",
  tente_depois: "Servidor ocupado. Tente novamente em instantes.",
  origem: "Conexão recusada pelo servidor (origem não permitida).",
  token_invalido: "Não foi possível retomar seu lugar nesta sala.",
  mensagem_invalida: "O servidor recusou uma mensagem inválida.",
};

export function erroMensagem(codigo: string): string {
  return Object.prototype.hasOwnProperty.call(ERROS, codigo)
    ? ERROS[codigo as ErroCodigo]
    : "Ocorreu um erro inesperado.";
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const session = (): StorageLike => window.sessionStorage;

export function safeGet(key: string, get: () => StorageLike = session): string | null {
  try {
    return get().getItem(key);
  } catch {
    return null;
  }
}

export function safeSet(key: string, value: string, get: () => StorageLike = session): void {
  try {
    get().setItem(key, value);
  } catch {
    /* modo privado/sem storage: segue sem persistir */
  }
}

export function safeRemove(key: string, get: () => StorageLike = session): void {
  try {
    get().removeItem(key);
  } catch {
    /* ignorado */
  }
}

export type ConnectPlan = "criar" | "entrar" | "reconectar" | "pedir_apelido" | "invalido" | "sessao_perdida";

/**
 * Decide como conectar. `seatedCode` = código em que ESTA página já se sentou.
 * Já sentado sem token (storage bloqueado e ref perdida) nunca entra/cria de novo:
 * isso ocuparia o outro assento da própria sala ou daria sala_cheia/W.O.
 */
export function planConnect(o: {
  param: RoomParam;
  storedToken: string | null;
  seatedCode: string | null;
  nick: string | null;
}): ConnectPlan {
  if (o.param.kind === "invalido") return "invalido";
  if (o.seatedCode !== null) return o.storedToken ? "reconectar" : "sessao_perdida";
  if (o.param.kind === "codigo" && o.storedToken) return "reconectar";
  if (!o.nick) return "pedir_apelido";
  return o.param.kind === "nova" ? "criar" : "entrar";
}

export function revancheDecision(fase: Fase | null, oponente: Assento): "enviar" | "indisponivel" | "ignorar" {
  if (fase !== "fim") return "ignorar";
  return oponente && oponente.conectado ? "enviar" : "indisponivel";
}

/** Conta falhas de conexão antes da primeira abertura bem-sucedida. */
export function connectGuard(maxFails: number) {
  let fails = 0;
  let everOpened = false;
  return {
    opened(): void {
      everOpened = true;
    },
    /** Registra uma falha; true quando deve desistir. */
    failed(): boolean {
      if (everOpened) return false;
      fails++;
      return fails >= maxFails;
    },
  };
}

export type RawSocket = {
  send(d: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
};

/** Embrulha um WebSocket para observar abertura/falha sem mexer no RoomClient. */
export function wrapSocket(raw: RawSocket, hooks: { onOpen(): void; onFailBeforeOpen(): void }): SocketLike {
  let opened = false;
  const w: SocketLike = {
    send: (d) => raw.send(d),
    close: () => raw.close(),
    onopen: null,
    onmessage: null,
    onclose: null,
  };
  raw.onopen = () => {
    opened = true;
    try {
      hooks.onOpen();
    } catch {
      /* ignorado */
    }
    w.onopen?.();
  };
  raw.onmessage = (e) => {
    if (typeof e.data === "string") w.onmessage?.({ data: e.data });
  };
  raw.onclose = () => {
    if (!opened) {
      try {
        hooks.onFailBeforeOpen();
      } catch {
        /* ignorado */
      }
    }
    w.onclose?.();
  };
  return w;
}

export type Seats = [Assento, Assento];

function cleanSeat(a: unknown): Assento {
  if (typeof a !== "object" || a === null) return null;
  const r = a as Record<string, unknown>;
  return typeof r.apelido === "string" ? { apelido: r.apelido.slice(0, 32), conectado: r.conectado === true } : null;
}

/** Valida o formato dos assentos vindos do servidor (apelido string, até 32 chars). */
export const cleanSeats = (v: unknown): Seats => (Array.isArray(v) ? [cleanSeat(v[0]), cleanSeat(v[1])] : [null, null]);

export type EstadoTela = {
  erro: { texto: string; podeTentar: boolean } | null;
  perdida: boolean;
  saindo: boolean;
  net: NetStatus;
  sala: { codigo: string } | null;
  oponente: Assento;
};

/** true quando um painel deve cobrir a mesa (e o HUD fica oculto). */
export function temOverlay(e: EstadoTela): boolean {
  return e.saindo || !!e.erro || e.perdida || e.net === "encerrada" || !e.sala || !e.oponente;
}

/** Aviso discreto sobre a mesa durante o jogo. */
export function avisoSala(o: { net: NetStatus; fase: Fase | null; revanche: string | null; oponente: Assento }): string | null {
  if (o.net === "reconectando") return "Reconectando…";
  if (o.revanche && o.fase === "fim") return o.revanche;
  if (o.oponente && !o.oponente.conectado && o.fase !== "fim") return "Adversário desconectado — aguardando reconexão…";
  return null;
}

/**
 * Token do assento: sessionStorage (sobrevive a recarga) + cópia em memória do módulo
 * (sobrevive a remontagens/navegação no mesmo documento mesmo com storage bloqueado).
 * `jaSentou` lembra os códigos onde este documento já teve assento.
 */
export function createSeatStore(get: () => StorageLike = session) {
  const tokens = new Map<string, string>();
  const seated = new Set<string>();
  return {
    token: (c: string): string | null => tokens.get(c) ?? safeGet(tokenKey(c), get),
    jaSentou: (c: string): boolean => seated.has(c),
    sentou(c: string, t: string): void {
      seated.add(c);
      tokens.set(c, t);
      safeSet(tokenKey(c), t, get);
    },
    esquecer(c: string): void {
      tokens.delete(c);
      safeRemove(tokenKey(c), get);
    },
  };
}

export const seatStore = createSeatStore();
