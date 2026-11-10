import { useRouter } from "next/navigation";
import { type RefObject, useEffect, useRef, useState } from "react";
import type { UiState } from "@/game/Game";
import { OnlineGame } from "@/game/OnlineGame";
import { RoomClient, type NetStatus } from "@/online/net";
import { ROOM_CODE_RE, type Fase, type ServerMsg } from "@/online/protocol";
import {
  cleanSeats,
  connectGuard,
  erroMensagem,
  planConnect,
  revancheDecision,
  SEM_CONEXAO,
  shouldForgetToken,
  seatStore,
  shareLink,
  wrapSocket,
  wsUrlFor,
  type RawSocket,
  revancheTexto,
  type SessaoEvento,
  type Seats,
} from "./roomHelpers";

const MAX_FALHAS_INICIAIS = 3;

export type RoomSessionProps = {
  codigoInicial: string | null; // null => criar sala
  apelido: string | null;
  onCodigo: (c: string) => void;
  onTentarDeNovo: () => void;
};

/** Conexão da sala: RoomClient + OnlineGame, estados da tela e ações (sair, revanche, copiar). */
export function useRoomSession(
  { codigoInicial, apelido, onCodigo }: RoomSessionProps,
  container: RefObject<HTMLDivElement | null>,
) {
  const router = useRouter();
  const clientRef = useRef<RoomClient | null>(null);
  const gameRef = useRef<OnlineGame | null>(null);
  const terminalRef = useRef(false);
  const onCodigoRef = useRef(onCodigo);
  // Código da sala desta montagem: o inicial ou o recebido em "sala" (para "nova").
  // Fixo por montagem: o RoomView atualizar o código resolvido não reconecta.
  const codigoRef = useRef(codigoInicial);

  const [net, setNet] = useState<NetStatus>("conectando");
  const [sala, setSala] = useState<{ codigo: string; voce: 0 | 1 } | null>(null);
  const [assentos, setAssentos] = useState<Seats>([null, null]);
  const [fase, setFase] = useState<Fase | null>(null);
  const [ui, setUi] = useState<UiState | null>(null);
  const [erro, setErro] = useState<{ texto: string; podeTentar: boolean } | null>(null);
  const [perdida, setPerdida] = useState(false);
  const [saindo, setSaindo] = useState(false);
  const [revanche, setRevanche] = useState<"pedida" | "indisponivel" | null>(null);
  const [copia, setCopia] = useState<string | null>(null);

  useEffect(() => {
    onCodigoRef.current = onCodigo;
  }, [onCodigo]);

  useEffect(() => {
    if (terminalRef.current) return;
    const code = codigoRef.current;
    // Token em memória do módulo ou no sessionStorage; "já sentou" sobrevive a remontagens.
    const storedToken = code ? seatStore.token(code) : null;
    const plan = planConnect({
      param: code ? { kind: "codigo", codigo: code } : { kind: "nova" },
      storedToken,
      seatedCode: code && seatStore.jaSentou(code) ? code : null,
      nick: apelido,
    });
    if (plan === "sessao_perdida") {
      terminalRef.current = true;
      setPerdida(true);
      return;
    }
    if (plan !== "criar" && plan !== "entrar" && plan !== "reconectar") return;

    let ended = false;
    let seated = false;
    let game: OnlineGame | null = null;
    const forgetToken = (ev: SessaoEvento) => {
      if (codigoRef.current && shouldForgetToken(ev)) seatStore.esquecer(codigoRef.current);
    };
    const terminal = (texto: string, podeTentar = true) => {
      terminalRef.current = true;
      setErro({ texto, podeTentar });
      client.close();
    };
    const guard = connectGuard(MAX_FALHAS_INICIAIS);

    const handle = (m: ServerMsg) => {
      switch (m.t) {
        case "sala": {
          if (typeof m.codigo !== "string" || !ROOM_CODE_RE.test(m.codigo)) return;
          if (m.voce !== 0 && m.voce !== 1) return;
          if (typeof m.token !== "string" || (code !== null && m.codigo !== code)) return;
          seated = true;
          codigoRef.current = m.codigo;
          seatStore.sentou(m.codigo, m.token);
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
          if (m.fase !== "fim") setRevanche(null);
          game?.apply(m);
          return;
        case "snapshot":
          game?.apply(m);
          return;
        case "erro":
          // Depois de sentado, só um aviso de mensagem inválida não encerra a sessão.
          if (seated && m.codigo === "mensagem_invalida") return;
          if (m.codigo === "token_invalido" || m.codigo === "sala_inexistente") {
            // Assento/sala mortos: sem "Tentar de novo" (evita reentrar na própria sala).
            forgetToken({ t: "erro", codigo: m.codigo });
            terminal(erroMensagem(m.codigo), false);
            return;
          }
          terminal(erroMensagem(m.codigo));
          return;
      }
    };

    const client = new RoomClient({
      url: wsUrlFor(window.location),
      // Conta falhas antes da 1ª abertura (servidor fora, Origin 403, 429): desiste após 3.
      makeSocket: (url) =>
        wrapSocket(new WebSocket(url) as unknown as RawSocket, {
          onOpen: () => guard.opened(),
          onFailBeforeOpen: () => {
            if (!ended && guard.failed()) terminal(SEM_CONEXAO);
          },
        }),
      // Os callbacks nunca podem lançar: o RoomClient não os protege.
      onStatus: (s) => {
        try {
          if (ended) return;
          // "encerrada" NÃO apaga o token: o assento pode seguir vivo na graça do servidor
          // (ex.: tente_depois ao reconectar) e "Tentar de novo" precisa do reconectar.
          setNet(s);
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
    // close() descarta a fila e nada chega ao servidor (uma única sala criada).
    if (plan === "reconectar" && code && storedToken) {
      client.setCredentials(code, storedToken);
      client.send({ t: "reconectar", codigo: code, token: storedToken });
    } else if (plan === "entrar" && code && apelido) {
      client.send({ t: "entrar_sala", codigo: code, apelido });
    } else if (plan === "criar" && apelido) {
      client.send({ t: "criar_sala", apelido });
    }

    return () => {
      ended = true; // antes do close(): o "encerrada" do cleanup não apaga o token
      client.close();
      game?.dispose();
      clientRef.current = null;
      gameRef.current = null;
    };
  }, [apelido, container]);

  const sair = () => {
    const c = clientRef.current;
    // Online, o navegador entrega o "sair" antes do fechamento. Offline (reconectando),
    // close() descarta o "sair" enfileirado e o servidor aplica a graça de 60 s.
    c?.send({ t: "sair" });
    terminalRef.current = true;
    setSaindo(true); // evita piscar "A sala foi encerrada" antes de navegar
    c?.close();
    if (codigoRef.current && shouldForgetToken({ t: "sair" })) seatStore.esquecer(codigoRef.current);
    router.push("/");
  };

  const oponente = sala ? assentos[1 - sala.voce] : null;

  const pedirRevanche = () => {
    const d = revancheDecision(fase, oponente);
    if (d === "indisponivel") setRevanche("indisponivel");
    if (d !== "enviar") return;
    clientRef.current?.send({ t: "revanche" });
    setRevanche("pedida");
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

  const setView = (v: "top" | "orbit") => gameRef.current?.setView(v);

  return {
    net,
    sala,
    assentos,
    fase,
    ui,
    erro,
    perdida,
    saindo,
    revanche: revancheTexto(revanche, oponente),
    copia,
    oponente,
    link,
    sair,
    pedirRevanche,
    copiar,
    setView,
  };
}
