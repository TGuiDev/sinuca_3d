import { describe, expect, it } from "vitest";
import { cleanNickname, parseClientMessage } from "./validate";

const p = (o: unknown) => parseClientMessage(JSON.stringify(o));
const TOKEN = "0123456789abcdef0123456789abcdef";

describe("parseClientMessage", () => {
  it("aceita os 7 tipos válidos", () => {
    expect(p({ t: "criar_sala", apelido: "Ana" })).toEqual({ t: "criar_sala", apelido: "Ana" });
    expect(p({ t: "entrar_sala", codigo: "ABC234", apelido: "Bia" })).toEqual({ t: "entrar_sala", codigo: "ABC234", apelido: "Bia" });
    expect(p({ t: "reconectar", codigo: "ABC234", token: TOKEN })).toEqual({ t: "reconectar", codigo: "ABC234", token: TOKEN });
    expect(p({ t: "tacada", angulo: 1.5, forca: 0.7 })).toEqual({ t: "tacada", angulo: 1.5, forca: 0.7 });
    expect(p({ t: "posicionar_branca", x: -1, y: 2 })).toEqual({ t: "posicionar_branca", x: -1, y: 2 });
    expect(p({ t: "revanche" })).toEqual({ t: "revanche" });
    expect(p({ t: "sair" })).toEqual({ t: "sair" });
  });

  it("devolve só as chaves conhecidas, sem poluir protótipo", () => {
    const raw = '{"t":"tacada","angulo":1,"forca":0.5,"extra":1,"__proto__":{"polluted":true}}';
    const r = parseClientMessage(raw);
    expect(Object.keys(r as object)).toEqual(["t", "angulo", "forca"]);
    expect(({} as any).polluted).toBeUndefined();
    expect((r as any).polluted).toBeUndefined();
  });

  it("rejeita entradas inválidas", () => {
    expect(parseClientMessage("não é json")).toBeNull();
    expect(parseClientMessage("[]")).toBeNull();
    expect(p({ t: "desconhecido" })).toBeNull();
    expect(p({ t: "tacada", angulo: "1", forca: 1 })).toBeNull();
    expect(parseClientMessage('{"t":"tacada","angulo":1e999,"forca":1}')).toBeNull();
    expect(p({ t: "entrar_sala", codigo: "ABC10O", apelido: "Bia" })).toBeNull();
    expect(p({ t: "reconectar", codigo: "ABC234", token: "xyz" })).toBeNull();
  });

  it("rejeita payload acima de 1024 bytes UTF-8", () => {
    expect(p({ t: "criar_sala", apelido: "a".repeat(2000) })).toBeNull();
    const emojis = "🎱".repeat(600);
    const raw = JSON.stringify({ t: "criar_sala", apelido: emojis });
    expect(Array.from(raw).length).toBeLessThan(1024);
    expect(Buffer.byteLength(raw, "utf8")).toBeGreaterThan(1024);
    expect(parseClientMessage(raw)).toBeNull();
  });

  it("normaliza codigo e apelido", () => {
    expect(p({ t: "entrar_sala", codigo: " abc234 ", apelido: "Bia" })).toEqual({ t: "entrar_sala", codigo: "ABC234", apelido: "Bia" });
    expect(p({ t: "criar_sala", apelido: "  Ana  Maria " })).toEqual({ t: "criar_sala", apelido: "Ana Maria" });
    expect(p({ t: "criar_sala", apelido: "a" })).toBeNull();
  });
});

describe("cleanNickname", () => {
  it("limpa e valida", () => {
    expect(cleanNickname("  Ana  Maria ")).toBe("Ana Maria");
    expect(cleanNickname("a")).toBeNull();
    expect(cleanNickname("a".repeat(17))).toBeNull();
    expect(cleanNickname("   ")).toBeNull();
    expect(cleanNickname("\u0000‮Ana")).toBe("Ana");
    expect(cleanNickname(42)).toBeNull();
    expect(cleanNickname(undefined)).toBeNull();
    expect(cleanNickname("Zé🎱")).toBe("Zé🎱");
  });
});
