import { ROOM_CODE_RE, type ErroCodigo } from "@/online/protocol";

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
