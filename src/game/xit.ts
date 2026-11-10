/**
 * Modo secreto: digitar `xit` no console do navegador liga/desliga as bolas teleguiadas
 * (só no modo contra a IA; no online o servidor é quem manda na física).
 */
export function installXit(onToggle: (on: boolean) => void): () => void {
  if (typeof window === "undefined") return () => {};
  let on = false;
  Object.defineProperty(window, "xit", {
    configurable: true,
    get() {
      on = !on;
      onToggle(on);
      return on ? "xit: bolas teleguiadas LIGADAS" : "xit: desligado";
    },
  });
  return () => {
    delete (window as unknown as Record<string, unknown>).xit;
  };
}
