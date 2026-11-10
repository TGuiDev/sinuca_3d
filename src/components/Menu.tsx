"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState, useSyncExternalStore } from "react";
import { APELIDO_KEY, cleanNickname, normalizeRoomCode, safeGet, safeSet } from "./roomHelpers";

const noopSubscribe = () => () => {};
const readStoredNick = () => safeGet(APELIDO_KEY) ?? "";
const serverNick = () => "";

const input =
  "w-full rounded-lg border border-white/20 bg-black/40 px-3 py-2 text-white placeholder:text-white/40 outline-none focus:border-amber-300";
const primary =
  "w-full rounded-lg bg-amber-400 px-4 py-2 font-semibold text-black hover:bg-amber-300 disabled:opacity-50";
const secondary =
  "w-full rounded-lg border border-white/20 bg-black/50 px-4 py-2 text-white hover:bg-black/70 disabled:opacity-50";

export default function Menu() {
  const router = useRouter();
  // Lido do sessionStorage só no cliente (sem divergência de hidratação).
  const stored = useSyncExternalStore(noopSubscribe, readStoredNick, serverNick);
  const [draft, setDraft] = useState<string | null>(null);
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const apelido = draft ?? stored;

  const nickOk = (): string | null => {
    const n = cleanNickname(apelido);
    if (!n) {
      setErro("Escolha um apelido de 2 a 16 caracteres.");
      return null;
    }
    safeSet(APELIDO_KEY, n);
    return n;
  };

  const criar = () => {
    if (nickOk()) router.push("/sala/nova");
  };

  const entrar = (e: FormEvent) => {
    e.preventDefault();
    const c = normalizeRoomCode(codigo);
    if (!c) {
      setErro("Código inválido: são 6 caracteres (letras e números).");
      return;
    }
    if (nickOk()) router.push(`/sala/${c}`);
  };

  return (
    <main className="grid min-h-screen place-items-center bg-[#10151c] p-4 text-white">
      <div className="w-full max-w-sm space-y-6 rounded-2xl border border-white/15 bg-black/40 p-6 backdrop-blur">
        <div className="text-center">
          <h1 className="text-3xl font-bold">Sinuca</h1>
          <p className="text-sm text-white/60">Bola 8</p>
        </div>

        <label className="block space-y-1">
          <span className="text-sm text-white/70">Apelido</span>
          <input
            className={input}
            value={apelido}
            maxLength={32}
            placeholder="Seu apelido"
            autoComplete="nickname"
            onChange={(e) => {
              setDraft(e.target.value);
              setErro(null);
            }}
          />
        </label>

        <div className="space-y-2">
          <button className={primary} onClick={() => router.push("/jogo")}>
            Jogar contra a IA
          </button>
          <button className={secondary} onClick={criar}>
            Criar sala
          </button>
        </div>

        <form onSubmit={entrar} className="flex gap-2">
          <input
            className={`${input} font-mono uppercase tracking-widest`}
            value={codigo}
            maxLength={6}
            placeholder="CÓDIGO"
            aria-label="Código da sala"
            autoCapitalize="characters"
            spellCheck={false}
            onChange={(e) => {
              setCodigo(e.target.value.toUpperCase().slice(0, 6));
              setErro(null);
            }}
          />
          <button type="submit" className={`${secondary} w-auto shrink-0`}>
            Entrar com código
          </button>
        </form>

        {erro && <p className="text-center text-sm text-red-300">{erro}</p>}
      </div>
    </main>
  );
}
