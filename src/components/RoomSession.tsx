"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { UiState } from "@/game/Game";
import { OnlineGame } from "@/game/OnlineGame";
import { RoomClient, type NetStatus } from "@/online/net";
import { ROOM_CODE_RE, type Assento, type Fase, type ServerMsg } from "@/online/protocol";
import { Hud } from "./Hud";
import { Painel, VoltarMenu, btnPrimary, btnSecondary } from "./RoomUi";
import { erroMensagem, safeGet, safeRemove, safeSet, shareLink, tokenKey, wsUrlFor } from "./roomHelpers";

type Seats = [Assento, Assento];

function cleanSeat(a: unknown): Assento {
  if (typeof a !== "object" || a === null) return null;
  const r = a as Record<string, unknown>;
  return typeof r.apelido === "string" ? { apelido: r.apelido.slice(0, 32), conectado: r.conectado === true } : null;
}
const cleanSeats = (v: unknown): Seats => (Array.isArray(v) ? [cleanSeat(v[0]), cleanSeat(v[1])] : [null, null]);

export default function RoomSession({
  codigoInicial,
  apelido,
  onCodigo,
  onTentarDeNovo,
}: {
  codigoInicial: string | null; // null => criar sala
  apelido: string;
  onCodigo: (c: string) => void;
  onTentarDeNovo: () => void;
}) {
  const router = useRouter();
  const container = useRef<HTMLDivElement>(null);
  const clientRef = useRef<RoomClient | null>(null);
  const gameRef = useRef<OnlineGame | null>(null);
  // Código conhecido (o inicial ou o recebido em "sala"): ao reexecutar o efeito
  // (Strict Mode / Activity) reconecta com o token em vez de criar outra sala.
  const codigoRef = useRef<string | null>(codigoInicial);
  const terminalRef = useRef(false);
  const onCodigoRef = useRef(onCodigo);

  const [net, setNet] = useState<NetStatus>("conectando");
  const [sala, setSala] = useState<{ codigo: string; voce: 0 | 1 } | null>(null);
  const [assentos, setAssentos] = useState<Seats>([null, null]);
  const [fase, setFase] = useState<Fase | null>(null);
  const [ui, setUi] = useState<UiState | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [revanche, setRevanche] = useState(false);
  const [copia, setCopia] = useState<string | null>(null);

  useEffect(() => {
    onCodigoRef.current = onCodigo;
  }, [onCodigo]);

  useEffect(() => {
    if (terminalRef.current) return;
    const known = codigoRef.current;
    const token = known ? safeGet(tokenKey(known)) : null;
    let ended = false;
    let seated = false;
    let game: OnlineGame | null = null;

    const handle = (m: ServerMsg) => {
      switch (m.t) {
        case "sala": {
          if (typeof m.codigo !== "string" || !ROOM_CODE_RE.test(m.codigo)) return;
          if (m.voce !== 0 && m.voce !== 1) return;
          if (typeof m.token !== "string" || (known !== null && m.codigo !== known)) return;
          seated = true;
          codigoRef.current = m.codigo;
          safeSet(tokenKey(m.codigo), m.token);
          client.setCredentials(m.codigo, m.token);
          if (window.location.pathname !== `/sala/${m.codigo}`) {
            window.history.replaceState(null, "", `/sala/${m.codigo}`);
          }
          onCodigoRef.current(m.codigo);
          const seats = cleanSeats(m.assentos);
          setSala({ codigo: m.codigo, voce: m.voce });
          setAssentos(seats);
          if (!game && container.current) {
            const names: [string, string] = [seats[0]?.apelido ?? "Jogador 1", seats[1]?.apelido ?? "Jogador 2"];
            game = new OnlineGame(container.current, m.voce, names, (msg) => client.send(msg), (s) => {
              if (!ended) setUi(s);
            });
            gameRef.current = game;
          }
          return;
        }
        case "assentos":
          setAssentos(cleanSeats(m.assentos));
          return;
        case "estado":
          setFase(m.fase);
          if (m.fase !== "fim") setRevanche(false);
          game?.apply(m);
          return;
        case "snapshot":
          game?.apply(m);
          return;
        case "erro": {
          // Depois de sentado, só um aviso de mensagem inválida não encerra a sessão.
          if (seated && m.codigo === "mensagem_invalida") return;
          if (m.codigo === "token_invalido" && codigoRef.current) safeRemove(tokenKey(codigoRef.current));
          terminalRef.current = true;
          setErro(erroMensagem(m.codigo));
          client.close();
          return;
        }
      }
    };

    const client = new RoomClient({
      url: wsUrlFor(window.location),
      // Os callbacks nunca podem lançar: o RoomClient não os protege.
      onStatus: (s) => {
        try {
          if (!ended) setNet(s);
        } catch {
          /* ignorado */
        }
      },
      onMessage: (m) => {
        try {
          if (!ended) handle(m);
        } catch {
          /* ignorado */
        }
      },
    });
    clientRef.current = client;

    // Enfileiradas até o socket abrir; se o efeito for desfeito antes (Strict Mode),
    // close() descarta a fila e nada chega ao servidor.
    if (known && token) {
      client.setCredentials(known, token);
      client.send({ t: "reconectar", codigo: known, token });
    } else if (known) {
      client.send({ t: "entrar_sala", codigo: known, apelido });
    } else {
      client.send({ t: "criar_sala", apelido });
    }

    return () => {
      ended = true;
      client.close();
      game?.dispose();
      clientRef.current = null;
      gameRef.current = null;
    };
  }, [apelido]);

  const sair = () => {
    const c = clientRef.current;
    c?.send({ t: "sair" });
    c?.close(); // o navegador entrega o "sair" já enviado antes do fechamento
    if (codigoRef.current) safeRemove(tokenKey(codigoRef.current));
    terminalRef.current = true;
    router.push("/");
  };

  const pedirRevanche = () => {
    if (fase !== "fim") return; // o servidor ignoraria fora do fim
    clientRef.current?.send({ t: "revanche" });
    setRevanche(true);
  };

  const link = sala ? shareLink(window.location.origin, sala.codigo) : "";
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopia("Link copiado!");
    } catch {
      setCopia("Não foi possível copiar; selecione o link e copie manualmente.");
    }
  };

  const oponente = sala ? assentos[1 - sala.voce] : null;
  const names: [string, string] = [assentos[0]?.apelido ?? "Jogador 1", assentos[1]?.apelido ?? "Jogador 2"];

  let overlay: ReactNode = null;
  if (erro) {
    overlay = (
      <Painel>
        <p className="text-lg font-semibold">{erro}</p>
        <div className="flex justify-center gap-2">
          <button className={btnPrimary} onClick={onTentarDeNovo}>
            Tentar de novo
          </button>
          <VoltarMenu />
        </div>
      </Painel>
    );
  } else if (net === "encerrada") {
    overlay = (
      <Painel>
        <p className="text-lg font-semibold">
          {sala ? "A sala foi encerrada" : "Não foi possível conectar ao servidor."}
        </p>
        <VoltarMenu />
      </Painel>
    );
  } else if (!sala) {
    overlay = (
      <Painel>
        <p className="text-lg">{net === "reconectando" ? "Reconectando…" : "Conectando…"}</p>
      </Painel>
    );
  } else if (!oponente) {
    overlay = (
      <Painel>
        <p className="text-lg font-semibold">Aguardando adversário</p>
        <p className="text-sm text-white/70">Envie o código ou o link para quem vai jogar com você.</p>
        <p className="font-mono text-3xl tracking-[0.3em] text-amber-300">{sala.codigo}</p>
        <input
          readOnly
          value={link}
          aria-label="Link da sala"
          onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-lg border border-white/20 bg-black/40 px-3 py-2 text-center text-sm text-white"
        />
        <button className={btnPrimary} onClick={copiar}>
          Copiar link
        </button>
        {copia && <p className="text-sm text-white/70">{copia}</p>}
        <button className={btnSecondary} onClick={sair}>
          Sair
        </button>
      </Painel>
    );
  }

  const aviso =
    net === "reconectando"
      ? "Reconectando…"
      : oponente && !oponente.conectado && fase !== "fim"
        ? "Adversário desconectado — aguardando reconexão…"
        : revanche && fase === "fim"
          ? "Revanche pedida — aguardando o adversário."
          : null;

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#10151c]">
      <div ref={container} className="absolute inset-0 touch-none select-none" />
      {!overlay && ui && sala && (
        <Hud
          state={ui}
          names={names}
          you={sala.voce}
          opponentHint="Vez do adversário..."
          restartLabel="Revanche"
          onRestart={pedirRevanche}
          onToggleView={() => gameRef.current?.setView(ui.view === "top" ? "orbit" : "top")}
        />
      )}
      {!overlay && sala && (
        <div className="absolute bottom-4 left-4 z-10 flex flex-col items-start gap-2">
          {aviso && <div className="rounded-full bg-black/70 px-4 py-1 text-sm text-amber-200">{aviso}</div>}
          <button className={btnSecondary} onClick={sair}>
            Sair
          </button>
        </div>
      )}
      {overlay && <div className="absolute inset-0 z-20 grid place-items-center bg-black/50 p-4">{overlay}</div>}
    </div>
  );
}
