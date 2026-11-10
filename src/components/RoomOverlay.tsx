import type { ReactNode } from "react";
import { SEM_CONEXAO, type EstadoTela } from "./roomHelpers";
import { Painel, VoltarMenu, btnPrimary, btnSecondary } from "./RoomUi";

/** Painel que cobre a mesa (ou null quando o jogo deve aparecer). Só texto React. */
export function RoomOverlay(
  p: EstadoTela & {
    link: string;
    copia: string | null;
    onCopiar: () => void;
    onSair: () => void;
    onTentarDeNovo: () => void;
  },
): ReactNode {
  if (p.saindo) {
    // Também é o que aparece se o usuário voltar (histórico) a esta sala depois de sair.
    return (
      <Painel>
        <p className="text-lg">Você saiu da sala.</p>
        <VoltarMenu />
      </Painel>
    );
  }
  if (p.erro) {
    return (
      <Painel>
        <p className="text-lg font-semibold">{p.erro.texto}</p>
        <div className="flex justify-center gap-2">
          {p.erro.podeTentar && (
            <button className={btnPrimary} onClick={p.onTentarDeNovo}>
              Tentar de novo
            </button>
          )}
          <VoltarMenu />
        </div>
      </Painel>
    );
  }
  if (p.perdida || p.net === "encerrada") {
    return (
      <Painel>
        <p className="text-lg font-semibold">{p.sala || p.perdida ? "A sala foi encerrada" : SEM_CONEXAO}</p>
        {p.perdida && (
          <p className="text-sm text-white/70">
            Sua sessão nesta sala foi perdida. Volte ao menu para criar ou entrar em outra sala.
          </p>
        )}
        <VoltarMenu />
      </Painel>
    );
  }
  // Sem assento ainda: nunca "Reconectando…".
  if (!p.sala) return <Painel><p className="text-lg">Conectando…</p></Painel>;
  if (!p.oponente) {
    return (
      <Painel>
        <p className="text-lg font-semibold">Aguardando adversário</p>
        <p className="text-sm text-white/70">Envie o código ou o link para quem vai jogar com você.</p>
        <p className="font-mono text-3xl tracking-[0.3em] text-amber-300">{p.sala.codigo}</p>
        <input
          readOnly
          value={p.link}
          aria-label="Link da sala"
          onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-lg border border-white/20 bg-black/40 px-3 py-2 text-center text-sm text-white"
        />
        <button className={btnPrimary} onClick={p.onCopiar}>
          Copiar link
        </button>
        {p.copia && <p className="text-sm text-white/70">{p.copia}</p>}
        <button className={btnSecondary} onClick={p.onSair}>
          Sair
        </button>
      </Painel>
    );
  }
  return null;
}
