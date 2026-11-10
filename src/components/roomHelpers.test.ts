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
  planConnect,
  revancheDecision,
  connectGuard,
  wrapSocket,
  cleanSeats,
  temOverlay,
  avisoSala,
  createSeatStore,
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

describe("planConnect", () => {
  const nova = { kind: "nova" } as const;
  const cod = { kind: "codigo", codigo: "ABC234" } as const;
  const base = { storedToken: null, seatedCode: null, nick: null };
  it("código inválido", () => {
    expect(planConnect({ ...base, param: { kind: "invalido" }, nick: "Ana" })).toBe("invalido");
  });
  it("nova sem assento cria (com apelido) ou pede apelido", () => {
    expect(planConnect({ ...base, param: nova, nick: "Ana" })).toBe("criar");
    expect(planConnect({ ...base, param: nova })).toBe("pedir_apelido");
  });
  it("código conhecido com token reconecta (mesmo sem apelido)", () => {
    expect(planConnect({ ...base, param: cod, storedToken: "t" })).toBe("reconectar");
  });
  it("código conhecido sem token entra (com apelido) ou pede apelido", () => {
    expect(planConnect({ ...base, param: cod, nick: "Ana" })).toBe("entrar");
    expect(planConnect({ ...base, param: cod })).toBe("pedir_apelido");
  });
  it("já sentado nesta página com token: reconecta (inclusive vindo de nova)", () => {
    expect(planConnect({ param: nova, storedToken: "t", seatedCode: "ABC234", nick: "Ana" })).toBe("reconectar");
    expect(planConnect({ param: cod, storedToken: "t", seatedCode: "ABC234", nick: "Ana" })).toBe("reconectar");
  });
  it("já sentado e SEM token: sessão perdida, nunca entrar/criar", () => {
    expect(planConnect({ param: cod, storedToken: null, seatedCode: "ABC234", nick: "Ana" })).toBe("sessao_perdida");
    expect(planConnect({ param: nova, storedToken: null, seatedCode: "ABC234", nick: "Ana" })).toBe("sessao_perdida");
    expect(planConnect({ param: cod, storedToken: null, seatedCode: "ABC234", nick: null })).toBe("sessao_perdida");
  });
});

describe("revancheDecision", () => {
  it("fora do fim ignora", () => {
    expect(revancheDecision("mira", { apelido: "B", conectado: true })).toBe("ignorar");
    expect(revancheDecision(null, null)).toBe("ignorar");
  });
  it("no fim com adversário conectado envia", () => {
    expect(revancheDecision("fim", { apelido: "B", conectado: true })).toBe("enviar");
  });
  it("no fim com adversário desconectado/ausente: indisponível", () => {
    expect(revancheDecision("fim", { apelido: "B", conectado: false })).toBe("indisponivel");
    expect(revancheDecision("fim", null)).toBe("indisponivel");
  });
});

describe("connectGuard", () => {
  it("desiste após N falhas antes de abrir", () => {
    const g = connectGuard(3);
    expect(g.failed()).toBe(false);
    expect(g.failed()).toBe(false);
    expect(g.failed()).toBe(true);
  });
  it("depois de abrir uma vez, quedas não contam", () => {
    const g = connectGuard(3);
    g.failed();
    g.opened();
    expect(g.failed()).toBe(false);
    expect(g.failed()).toBe(false);
    expect(g.failed()).toBe(false);
  });
});

describe("wrapSocket", () => {
  function fakeRaw() {
    return {
      sent: [] as string[],
      closed: 0,
      onopen: null as (() => void) | null,
      onmessage: null as ((e: { data: unknown }) => void) | null,
      onclose: null as (() => void) | null,
      send(d: string) {
        this.sent.push(d);
      },
      close() {
        this.closed++;
      },
    };
  }
  it("repassa eventos e envio, avisando abertura e falha antes de abrir", () => {
    const raw = fakeRaw();
    const ev: string[] = [];
    const w = wrapSocket(raw, { onOpen: () => ev.push("open"), onFailBeforeOpen: () => ev.push("fail") });
    const got: string[] = [];
    w.onopen = () => got.push("o");
    w.onmessage = (e) => got.push(e.data);
    w.onclose = () => got.push("c");
    raw.onopen!();
    raw.onmessage!({ data: "x" });
    raw.onclose!();
    w.send("y");
    w.close();
    expect(got).toEqual(["o", "x", "c"]);
    expect(ev).toEqual(["open"]);
    expect(raw.sent).toEqual(["y"]);
    expect(raw.closed).toBe(1);
  });
  it("fechamento sem abrir chama onFailBeforeOpen antes do onclose; hooks que lançam não quebram", () => {
    const raw = fakeRaw();
    const ev: string[] = [];
    const w = wrapSocket(raw, {
      onOpen: () => {},
      onFailBeforeOpen: () => {
        ev.push("fail");
        throw new Error("boom");
      },
    });
    w.onclose = () => ev.push("c");
    expect(() => raw.onclose!()).not.toThrow();
    expect(ev).toEqual(["fail", "c"]);
  });
  it("ignora mensagens não-string", () => {
    const raw = fakeRaw();
    const w = wrapSocket(raw, { onOpen: () => {}, onFailBeforeOpen: () => {} });
    const got: unknown[] = [];
    w.onmessage = (e) => got.push(e.data);
    raw.onmessage!({ data: new ArrayBuffer(2) });
    expect(got).toEqual([]);
  });
});

describe("cleanSeats", () => {
  it("aceita só o formato esperado e corta apelidos longos", () => {
    expect(cleanSeats([{ apelido: "Ana", conectado: true }, null])).toEqual([{ apelido: "Ana", conectado: true }, null]);
    expect(cleanSeats([{ apelido: 3 }, { apelido: "x".repeat(40), conectado: "sim" }])).toEqual([
      null,
      { apelido: "x".repeat(32), conectado: false },
    ]);
    expect(cleanSeats("lixo")).toEqual([null, null]);
  });
});

describe("temOverlay / avisoSala", () => {
  const ok = { erro: null, perdida: false, saindo: false, net: "online" as const, sala: { codigo: "ABC234" }, oponente: { apelido: "B", conectado: true } };
  it("só mostra a mesa sentado, com adversário e sem erro", () => {
    expect(temOverlay(ok)).toBe(false);
    expect(temOverlay({ ...ok, sala: null })).toBe(true);
    expect(temOverlay({ ...ok, oponente: null })).toBe(true);
    expect(temOverlay({ ...ok, perdida: true })).toBe(true);
    expect(temOverlay({ ...ok, saindo: true })).toBe(true);
    expect(temOverlay({ ...ok, net: "encerrada" })).toBe(true);
    expect(temOverlay({ ...ok, erro: { texto: "x", podeTentar: true } })).toBe(true);
  });
  it("prioriza reconectando, depois revanche no fim, depois adversário desconectado", () => {
    const B = { apelido: "B", conectado: false };
    expect(avisoSala({ net: "reconectando", fase: "fim", revanche: "r", oponente: B })).toBe("Reconectando…");
    expect(avisoSala({ net: "online", fase: "fim", revanche: "r", oponente: B })).toBe("r");
    expect(avisoSala({ net: "online", fase: "mira", revanche: null, oponente: B })).toMatch(/desconectado/);
    expect(avisoSala({ net: "online", fase: "mira", revanche: null, oponente: { apelido: "B", conectado: true } })).toBeNull();
  });
});

describe("createSeatStore", () => {
  const blocked = () => {
    throw new Error("SecurityError");
  };
  it("com storage bloqueado mantém token e assento em memória", () => {
    const st = createSeatStore(blocked);
    expect(st.token("ABC234")).toBeNull();
    expect(st.jaSentou("ABC234")).toBe(false);
    st.sentou("ABC234", "tok");
    expect(st.token("ABC234")).toBe("tok");
    expect(st.jaSentou("ABC234")).toBe(true);
  });
  it("esquecer apaga o token mas lembra que já sentou (nunca reentrar)", () => {
    const st = createSeatStore(blocked);
    st.sentou("ABC234", "tok");
    st.esquecer("ABC234");
    expect(st.token("ABC234")).toBeNull();
    expect(st.jaSentou("ABC234")).toBe(true);
  });
  it("lê token do sessionStorage (outra montagem/recarga) e grava nele", () => {
    const m = new Map<string, string>([["sinuca:token:XYZ234", "antigo"]]);
    const s = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
    const st = createSeatStore(() => s);
    expect(st.token("XYZ234")).toBe("antigo");
    st.sentou("ABC234", "tok");
    expect(m.get("sinuca:token:ABC234")).toBe("tok");
    st.esquecer("ABC234");
    expect(m.has("sinuca:token:ABC234")).toBe(false);
  });
});
