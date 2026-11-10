import Link from "next/link";
import type { ReactNode } from "react";

export function Painel({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-auto w-full max-w-sm space-y-4 rounded-2xl border border-white/15 bg-black/70 p-6 text-center text-white backdrop-blur">
      {children}
    </div>
  );
}

export const btnPrimary = "rounded-lg bg-amber-400 px-5 py-2 font-semibold text-black hover:bg-amber-300";
export const btnSecondary = "rounded-lg border border-white/20 bg-black/50 px-5 py-2 text-white hover:bg-black/70";

export function VoltarMenu() {
  return (
    <Link href="/" className={`inline-block ${btnSecondary}`}>
      Voltar ao menu
    </Link>
  );
}
