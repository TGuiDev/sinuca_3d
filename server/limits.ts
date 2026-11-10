/** Balde de fichas: `ratePerSec` fichas/s, acumulando até `burst`. Tempo (ms) injetado. */
export class TokenBucket {
  private tokens: number;
  private last: number | null = null;

  constructor(
    private readonly ratePerSec: number,
    private readonly burst: number,
  ) {
    this.tokens = burst;
  }

  take(now: number): boolean {
    if (this.last === null) {
      this.last = now;
    } else if (now > this.last) {
      const refill = ((now - this.last) / 1000) * this.ratePerSec;
      this.tokens = Math.min(this.burst, this.tokens + refill);
      this.last = now;
    } // relógio para trás: não reabastece nem recua
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}

/** Contador por chave em janela fixa iniciada no primeiro hit; chaves expiradas são podadas. */
export class WindowCounter {
  // Ordem de inserção == ordem de início da janela (reinício faz delete+set).
  private readonly entries = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  hit(key: string, now: number): boolean {
    for (const [k, e] of this.entries) {
      if (now - e.start > this.windowMs) this.entries.delete(k);
      else break;
    }
    const e = this.entries.get(key);
    if (!e) {
      this.entries.set(key, { start: now, count: 1 });
      return this.limit >= 1;
    }
    if (e.count >= this.limit) return false;
    e.count += 1;
    return true;
  }
}
