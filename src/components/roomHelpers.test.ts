import { describe, expect, it } from "vitest";
import {
  APELIDO_KEY,
  cleanNickname,
  erroMensagem,
  normalizeRoomCode,
  parseRoomParam,
  safeGet,
  safeRemove,
  safeSet,
  shareLink,
  tokenKey,
  wsUrlFor,
} from "./roomHelpers";

describe("cleanNickname", () => {
  it("aceita 2-16 caracteres após trim", () => {
    expect(cleanNickname("  Ana  ")).toBe("Ana");
    expect(cleanNickname("ab")).toBe("ab");
    expect(cleanNickname("a".repeat(16))).toBe("a".repeat(16));
  });
  it("rejeita curtos, longos e não-strings", () => {
    expect(cleanNickname("a")).toBeNull();
    expect(cleanNickname("   ")).toBeNull();
    expect(cleanNickname("a".repeat(17))).toBeNull();
    expect(cleanNickname(42)).toBeNull();
  });
  it("remove caracteres de controle e colapsa espaços", () => {
    expect(cleanNickname("Jo\u0000\u0007ão\t  Silva")).toBe("João Silva");
    expect(cleanNickname("​​x")).toBeNull();
  });
  it("conta code points, não unidades UTF-16", () => {
    expect(cleanNickname("🎱".repeat(16))).toBe("🎱".repeat(16));
    expect(cleanNickname("🎱".repeat(17))).toBeNull();
  });
});

describe("normalizeRoomCode / parseRoomParam", () => {
  it("normaliza maiúsculas e trim", () => {
    expect(normalizeRoomCode(" abc234 ")).toBe("ABC234");
  });
  it("rejeita códigos fora do alfabeto ou tamanho errado", () => {
    expect(normalizeRoomCode("ABC10I")).toBeNull();
    expect(normalizeRoomCode("ABC23")).toBeNull();
    expect(normalizeRoomCode("!!")).toBeNull();
  });
  it("interpreta o parâmetro da rota", () => {
    expect(parseRoomParam("nova")).toEqual({ kind: "nova" });
    expect(parseRoomParam("abc234")).toEqual({ kind: "codigo", codigo: "ABC234" });
    expect(parseRoomParam("%21%21")).toEqual({ kind: "invalido" });
    expect(parseRoomParam("%E0%A4%A")).toEqual({ kind: "invalido" });
    expect(parseRoomParam("NOVA")).toEqual({ kind: "invalido" });
  });
});

describe("wsUrlFor", () => {
  it("usa ws://localhost:8787 em localhost e 127.0.0.1", () => {
    expect(wsUrlFor({ hostname: "localhost", host: "localhost:3100" })).toBe("ws://localhost:8787/socket");
    expect(wsUrlFor({ hostname: "127.0.0.1", host: "127.0.0.1:3100" })).toBe("ws://localhost:8787/socket");
  });
  it("usa wss no mesmo host em produção", () => {
    expect(wsUrlFor({ hostname: "sinuca.example.com", host: "sinuca.example.com" })).toBe(
      "wss://sinuca.example.com/socket",
    );
  });
});

describe("shareLink / tokenKey", () => {
  it("monta o link sem token nem apelido", () => {
    expect(shareLink("https://x.dev", "ABC234")).toBe("https://x.dev/sala/ABC234");
  });
  it("chaves do sessionStorage", () => {
    expect(tokenKey("ABC234")).toBe("sinuca:token:ABC234");
    expect(APELIDO_KEY).toBe("sinuca:apelido");
  });
});

describe("erroMensagem", () => {
  it("mapeia todos os códigos para português", () => {
    const codigos = [
      "sala_cheia",
      "sala_inexistente",
      "limite",
      "tente_depois",
      "origem",
      "token_invalido",
      "mensagem_invalida",
    ] as const;
    const textos = codigos.map(erroMensagem);
    for (const t of textos) expect(t.length).toBeGreaterThan(5);
    expect(new Set(textos).size).toBe(codigos.length);
  });
  it("nunca ecoa um código desconhecido", () => {
    const t = erroMensagem("<script>x</script>");
    expect(t).not.toContain("script");
  });
});

describe("safe storage", () => {
  const throwing = {
    getItem: () => {
      throw new Error("x");
    },
    setItem: () => {
      throw new Error("x");
    },
    removeItem: () => {
      throw new Error("x");
    },
  };
  it("não lança quando o storage lança", () => {
    expect(safeGet("k", () => throwing)).toBeNull();
    expect(() => safeSet("k", "v", () => throwing)).not.toThrow();
    expect(() => safeRemove("k", () => throwing)).not.toThrow();
  });
  it("não lança quando o getter lança", () => {
    const boom = () => {
      throw new Error("SecurityError");
    };
    expect(safeGet("k", boom)).toBeNull();
    expect(() => safeSet("k", "v", boom)).not.toThrow();
  });
  it("lê e grava num storage funcional", () => {
    const m = new Map<string, string>();
    const s = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
    safeSet("k", "v", () => s);
    expect(safeGet("k", () => s)).toBe("v");
    safeRemove("k", () => s);
    expect(safeGet("k", () => s)).toBeNull();
  });
});
