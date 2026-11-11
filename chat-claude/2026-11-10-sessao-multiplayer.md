# Sessão de 2026-11-10 — Deploy da sinuca e multiplayer (etapa 1)

Registro para retomar o trabalho depois. Não é a transcrição literal: é um resumo fiel das decisões, do estado e dos próximos passos. **Nenhum segredo está aqui.** A API key do Dokploy fica em `/root/.config/dokploy/api_key` (permissão 600) no servidor, e nunca deve ser commitada.

## 1. O que já está no ar

- A sinuca (`TGuiDev/sinuca_3d`, branch `master`) está hospedada no Dokploy em **https://sinuca.guidev.site**.
- Projeto Dokploy **Sinuca** (`projectId 6TmwV3QzNMtwTmQXhbvrK`, ambiente `production` `Hh519YIqtFl8Vc0lwKIUD`), app `sinuca-web` (`applicationId xiE1qbD9rhjCqaHjnE791`), build **Nixpacks**, porta 3000.
- Domínio com `https=false` no Dokploy, igual aos outros domínios do servidor: o HTTPS é do Cloudflare. Com `https=true` o site entrava em loop de redirecionamento (308).
- Variáveis de ambiente do app (manter): `NIXPACKS_NODE_VERSION=22` (o Next 16 exige Node ≥ 20.9; o Nixpacks escolhia 18) e `NODE_OPTIONS=--experimental-require-module` (o Node 22 do Nixpacks é antigo e não deixava o `@tailwindcss/turbopack` fazer `require()` de módulo ES).
- Deploy automático **desligado**: só publica quando alguém clica em *Deploy* ou chama a API (`application.deploy`).
- API do Dokploy em `http://localhost:3000/api` (header `x-api-key`).

## 2. O pedido e a decisão de escopo

Pedido: o jogo deve ser **contra a IA** ou **em sala contra outro jogador**, com **login**, **partidas ranqueadas por matchmaking** e **ranking global**.

Hoje o jogo já era jogador vs CPU. Foi dividido em **3 etapas**, cada uma com spec, plano e deploy:

1. **Etapa 1 (em andamento):** tela inicial, modo IA preservado, servidor em tempo real e salas por código/link com apelido de convidado, sem conta.
2. **Etapa 2:** contas e persistência (login, Postgres, histórico).
3. **Etapa 3:** ranqueado (fila de matchmaking, Elo, ranking global, antitrapaça).

Decisões tomadas com o usuário:

- Entrada na sala por **código/link**. Ranqueado vem na etapa 3.
- **Servidor simula a física e transmite as posições** (abordagem A). Não há física no cliente online. É a base do ranqueado e anti-trapaça.
- **Segurança é requisito em todas as partes.**
- Login **não** está na etapa 1; fica na etapa 2.

## 3. Documentos (na branch `feat/multiplayer-etapa1`)

- Spec: `docs/superpowers/specs/2026-11-10-multiplayer-etapa1-design.md`
- Plano (12 tarefas): `docs/superpowers/plans/2026-11-10-multiplayer-etapa1.md`

Resumo da arquitetura: Cliente Next com `/` (menu), `/jogo` (modo IA local, `Game.ts` intocado) e `/sala/[codigo]` (online). Um `server/` em Node + `ws` com salas em memória, importando `src/physics` e `src/rules`. Segundo app no Dokploy (`sinuca-server`), com o domínio `sinuca.guidev.site` roteando `/socket` para ele.

Decisões que o plano tomou além da spec:

- `protocol.ts` fica em `src/online/` (cliente e servidor importam).
- **Revanche** só começa quando os dois pedem.
- Tacada com força abaixo de 0,03 é ignorada; tacada com mais de 30 s de simulação é encerrada à força.

## 4. Estado da execução (subagent-driven)

Execução com um subagente implementador por tarefa e um revisor por tarefa. Ledger de trabalho (git-ignorado): `.superpowers/sdd/2026-11-10-multiplayer-etapa1/progress.md`.

| Tarefa | Estado | Commits |
|---|---|---|
| 1 Protocolo e validação | concluída | `318c21f` |
| 2 Limites de taxa | concluída | `e5e3805` |
| 3 Fim de tacada compartilhado (`src/game/turn.ts`) | concluída | `59471db` |
| 4-10 Servidor autoritativo, sala, gerenciador, WebSocket, Dockerfile, cliente de rede, cena online | concluídas e revisadas | ver `git log feat/multiplayer-etapa1` |
| 11 Páginas: menu, `/jogo`, `/sala/[codigo]` | concluída (3 commits: `7bd9af3`, `d26b7a3`, `c0759f4`) | |
| 12 Deploy no Dokploy | **pendente: precisa do OK do usuário para o `git push`** | — |

Verificação atual: 159 testes em 15 arquivos, lint e tsc ok, build lista `/`, `/jogo`, `/sala/[codigo]`.

Depois da Task 12: revisão final da branch inteira (modelo mais capaz), correção em uma rodada só, e `finishing-a-development-branch`.

## 5. Pendências e cuidados para retomar

- **Nada foi enviado ao GitHub.** Todos os commits estão só no clone local. O `git push` só acontece com OK explícito do usuário (Task 12).
- **Commits sem co-autoria do Claude** e com a identidade do próprio usuário (regra do usuário).
- **Task 1 (observações menores adiadas):** `toUpperCase()` aceita alguns caracteres Unicode (saída segue ASCII válida); apelido só de caracteres invisíveis passa; faltam testes de fronteira (1024/1025 bytes etc.); `ALFABETO` duplicado no `ROOM_CODE_RE`; **conferir na Task 8** que o `package-lock.json` perdeu campos `libc` (importa para a imagem Alpine/musl).
- **Task 2:** poda do `WindowCounter` assume relógio não decrescente (a Task 7 deve usar relógio monotônico); faltam testes de borda; comentário em `limits.ts:109` cita um `delete+set` que não existe.
- **Task 3:** `HEAD_SPOT` duplicado em `Game.ts:24`; a branca é reposta sem clamp. A Task 4 deve aplicar `clampCuePlacement` ao entrar em "posicionando".
- **Task 8:** `npx tsc --noEmit` tem 1 erro pré-existente em `src/app/layout.tsx` (`LayoutProps`, tipo gerado pelo Next); `npm audit` aponta vulnerabilidades. Isso deve ser reportado ao usuário, não silenciado.
- **Task 11:** `AGENTS.md` do repo pede ler `node_modules/next/dist/docs/` antes de escrever páginas; `cacheComponents` está ligado.
- Um arquivo `.swp` do vim apareceu em `docs/superpowers/specs/`: o usuário talvez tenha aberto a spec no editor. Reler a spec antes de continuar, caso ele tenha alterado algo.

## 6. Como retomar

1. Abrir o clone (hoje em `/tmp/claude-0/-home-servidor/e27b93b2-e877-46c2-97e3-e0e3da85d989/scratchpad/sinuca_3d`, uma pasta temporária da sessão). **Se esse diretório sumir, clonar `TGuiDev/sinuca_3d` de novo.** O push das branches e deste registro precisa do OK do usuário.
2. Ler o ledger (se existir) e `git log feat/multiplayer-etapa1` para ver o que já foi concluído.
3. Continuar o plano a partir da primeira tarefa sem linha `complete` no ledger (hoje, a Task 4).
