"use client";

import { type FormEvent, type ReactNode, useState } from "react";
import { Painel, VoltarMenu, btnPrimary } from "./RoomUi";
import RoomSession from "./RoomSession";
import { APELIDO_KEY, cleanNickname, parseRoomParam, safeGet, safeSet, tokenKey } from "./roomHelpers";

function Tela({ children }: { children: ReactNode }) {
  return <main className="grid min-h-screen place-items-center bg-[#10151c] p-4">{children}</main>;
}

/**
 * Decide o que fazer com o parâmetro da URL antes de conectar:
 * código inválido não conecta; sem apelido (e sem token salvo) pede o apelido.
 * Este componente só roda no cliente (carregado com ssr:false).
 */
export default function RoomView({ codigo: raw }: { codigo: string }) {
  const param = parseRoomParam(raw);
  const [apelido, setApelido] = useState<string | null>(() => cleanNickname(safeGet(APELIDO_KEY)));
  const [draft, setDraft] = useState("");
  const [nickErro, setNickErro] = useState(false);
  // Código real depois de "nova" (vindo do servidor) e contador de novas tentativas.
  const [resolvido, setResolvido] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);

  if (param.kind === "invalido") {
    return (
      <Tela>
        <Painel>
          <p className="text-lg font-semibold">Código de sala inválido.</p>
          <p className="text-sm text-white/70">O código tem 6 caracteres (letras e números).</p>
          <VoltarMenu />
        </Painel>
      </Tela>
    );
  }

  const codigo = resolvido ?? (param.kind === "codigo" ? param.codigo : null);
  const temToken = codigo !== null && safeGet(tokenKey(codigo)) !== null;

  if (!apelido && !temToken) {
    const enviar = (e: FormEvent) => {
      e.preventDefault();
      const n = cleanNickname(draft);
      if (!n) return setNickErro(true);
      safeSet(APELIDO_KEY, n);
      setApelido(n);
    };
    return (
      <Tela>
        <Painel>
          <p className="text-lg font-semibold">Escolha um apelido para jogar</p>
          <form onSubmit={enviar} className="space-y-3">
            <input
              autoFocus
              value={draft}
              maxLength={32}
              placeholder="Seu apelido"
              aria-label="Apelido"
              className="w-full rounded-lg border border-white/20 bg-black/40 px-3 py-2 text-white outline-none focus:border-amber-300"
              onChange={(e) => {
                setDraft(e.target.value);
                setNickErro(false);
              }}
            />
            {nickErro && <p className="text-sm text-red-300">O apelido deve ter de 2 a 16 caracteres.</p>}
            <button type="submit" className={btnPrimary}>
              Continuar
            </button>
          </form>
          <VoltarMenu />
        </Painel>
      </Tela>
    );
  }

  return (
    <RoomSession
      key={tentativa}
      codigoInicial={codigo}
      apelido={apelido ?? ""}
      onCodigo={setResolvido}
      onTentarDeNovo={() => setTentativa((t) => t + 1)}
    />
  );
}
