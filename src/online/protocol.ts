export const MAX_MESSAGE_BYTES = 1024;
export const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
export const TOKEN_RE = /^[0-9a-f]{32}$/;

export type ClientMsg =
  | { t: "criar_sala"; apelido: string }
  | { t: "entrar_sala"; codigo: string; apelido: string }
  | { t: "reconectar"; codigo: string; token: string }
  | { t: "tacada"; angulo: number; forca: number }
  | { t: "posicionar_branca"; x: number; y: number }
  | { t: "mirar"; angulo: number; forca: number }
  | { t: "mover_branca"; x: number; y: number }
  | { t: "revanche" }
  | { t: "sair" };

export type Fase = "aguardando" | "mira" | "rolando" | "posicionando" | "fim";

export type Assento = { apelido: string; conectado: boolean } | null;

export type ErroCodigo =
  | "mensagem_invalida"
  | "sala_inexistente"
  | "sala_cheia"
  | "token_invalido"
  | "limite"
  | "origem"
  | "tente_depois";

export type ServerMsg =
  | { t: "sala"; codigo: string; assentos: [Assento, Assento]; voce: 0 | 1; token: string }
  | { t: "assentos"; assentos: [Assento, Assento] }
  | {
      t: "estado";
      turno: 0 | 1;
      grupos: [string | null, string | null];
      encacapadas: number[];
      mensagem: string;
      vencedor: 0 | 1 | null;
      fase: Fase;
    }
  | { t: "snapshot"; bolas: [number, number, number, 0 | 1][] }
  | { t: "mira"; angulo: number; forca: number }
  | { t: "branca"; x: number; y: number }
  | { t: "erro"; codigo: ErroCodigo };
