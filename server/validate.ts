import {
  MAX_MESSAGE_BYTES,
  ROOM_CODE_RE,
  TOKEN_RE,
  type ClientMsg,
} from "../src/online/protocol";

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

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function cleanCode(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const c = v.trim().toUpperCase();
  return ROOM_CODE_RE.test(c) ? c : null;
}

export function parseClientMessage(raw: string): ClientMsg | null {
  if (typeof raw !== "string") return null;
  if (Buffer.byteLength(raw, "utf8") > MAX_MESSAGE_BYTES) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const m = data as Record<string, unknown>;
  switch (m.t) {
    case "criar_sala": {
      const apelido = cleanNickname(m.apelido);
      return apelido === null ? null : { t: "criar_sala", apelido };
    }
    case "entrar_sala": {
      const codigo = cleanCode(m.codigo);
      const apelido = cleanNickname(m.apelido);
      return codigo === null || apelido === null ? null : { t: "entrar_sala", codigo, apelido };
    }
    case "reconectar": {
      const codigo = cleanCode(m.codigo);
      const token = m.token;
      if (codigo === null || typeof token !== "string" || !TOKEN_RE.test(token)) return null;
      return { t: "reconectar", codigo, token };
    }
    case "tacada":
      return finite(m.angulo) && finite(m.forca)
        ? { t: "tacada", angulo: m.angulo, forca: m.forca }
        : null;
    case "posicionar_branca":
      return finite(m.x) && finite(m.y) ? { t: "posicionar_branca", x: m.x, y: m.y } : null;
    case "mirar":
      return finite(m.angulo) && finite(m.forca) ? { t: "mirar", angulo: m.angulo, forca: m.forca } : null;
    case "mover_branca":
      return finite(m.x) && finite(m.y) ? { t: "mover_branca", x: m.x, y: m.y } : null;
    case "revanche":
      return { t: "revanche" };
    case "sair":
      return { t: "sair" };
    default:
      return null;
  }
}
