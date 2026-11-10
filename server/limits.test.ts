import { describe, expect, it } from "vitest";
import { TokenBucket, WindowCounter } from "./limits";

describe("TokenBucket", () => {
  it("permite rajada até burst e bloqueia o excedente", () => {
    const b = new TokenBucket(2, 3);
    expect(b.take(0)).toBe(true);
    expect(b.take(0)).toBe(true);
    expect(b.take(0)).toBe(true);
    expect(b.take(0)).toBe(false);
  });
  it("reabastece com o tempo", () => {
    const b = new TokenBucket(2, 3);
    for (let i = 0; i < 3; i++) b.take(0);
    expect(b.take(500)).toBe(true);
    expect(b.take(500)).toBe(false);
  });
  it("nunca passa de burst", () => {
    const b = new TokenBucket(2, 3);
    for (let i = 0; i < 3; i++) expect(b.take(1_000_000)).toBe(true);
    expect(b.take(1_000_000)).toBe(false);
  });
  it("ignora relógio andando para trás", () => {
    const b = new TokenBucket(2, 1);
    expect(b.take(1000)).toBe(true);
    expect(b.take(0)).toBe(false);
    expect(b.take(1000)).toBe(false);
  });
});

describe("WindowCounter", () => {
  it("limita por chave dentro da janela", () => {
    const w = new WindowCounter(2, 1000);
    expect(w.hit("a", 0)).toBe(true);
    expect(w.hit("a", 0)).toBe(true);
    expect(w.hit("a", 0)).toBe(false);
    expect(w.hit("b", 0)).toBe(true);
  });
  it("libera após a janela e remove chaves expiradas", () => {
    const w = new WindowCounter(2, 1000);
    w.hit("a", 0);
    w.hit("a", 0);
    w.hit("b", 0);
    expect(w.size).toBe(2);
    expect(w.hit("a", 1000)).toBe(false); // borda: ainda dentro
    expect(w.hit("a", 1001)).toBe(true);
    expect(w.size).toBe(1);
  });
  it("tentativas negadas não estendem a janela", () => {
    const w = new WindowCounter(1, 1000);
    w.hit("a", 0);
    w.hit("a", 900);
    expect(w.hit("a", 1001)).toBe(true);
  });
});
