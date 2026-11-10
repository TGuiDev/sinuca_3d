# Sinuca — Etapa 1: tela inicial, modo IA e salas multiplayer

## Contexto e roadmap
O jogo hoje é Bola 8 jogador vs CPU, 100% no navegador. O pedido completo é: escolher entre jogar contra a IA ou contra outro jogador, com salas por código/link e, depois, partidas ranqueadas por matchmaking com ranking global.

Isso foi dividido em três etapas, cada uma com spec, plano e deploy próprios:

1. **Esta spec:** tela inicial, modo IA preservado, servidor em tempo real e salas por código/link com apelido de convidado.
2. **Contas e persistência:** login, Postgres, histórico de partidas.
3. **Ranqueado:** fila de matchmaking, Elo, ranking global e antitrapaça.

A etapa 1 já é desenhada para as seguintes: o servidor é a autoridade da física e trata cada assento como "um jogador com identidade". Na etapa 2, "apelido de convidado" passa a ser "usuário logado".

## Objetivo e critério de sucesso
Duas pessoas, em navegadores diferentes, jogam uma partida completa de Bola 8 em `https://sinuca.guidev.site`, uma criando a sala e a outra entrando pelo código ou link. O modo contra a IA continua funcionando exatamente como hoje.

## Decisões já tomadas
- **Entrada na sala:** código curto e link. Sem lobby público e sem matchmaking nesta etapa.
- **Física no multiplayer:** o servidor simula e transmite as posições; os clientes só desenham. Não há física no cliente online.
- **Sem contas, sem banco:** salas em memória, apelido de convidado.
- **Segurança é requisito em todas as partes** (ver seção própria).

## Arquitetura
Três peças no mesmo repositório:

1. **Cliente Next (existente):**
   - `/` tela inicial: "Jogar contra a IA", "Criar sala", "Entrar com código".
   - `/jogo` modo IA, local e sem servidor.
   - `/sala/[codigo]` modo online (o link compartilhável).
2. **`server/` (novo):** Node + WebSocket (`ws`), salas em memória. Importa `src/physics` e `src/rules` do cliente, mantendo uma única fonte de verdade da física e das regras. Build com `esbuild`, que resolve o alias `@/`.
3. **Deploy:** `sinuca-server` como segundo app no projeto Sinuca do Dokploy. O domínio `sinuca.guidev.site` roteia `/socket` para ele e o restante para o Next.

### Módulos do servidor
- `protocol.ts` — tipos das mensagens, compartilhados com o cliente.
- `validate.ts` — validação em tempo de execução de toda mensagem recebida.
- `room.ts` — uma sala: 2 assentos, código, mundo da física, regras, loop de simulação, reconexão e W.O.
- `rooms.ts` — criação de salas, geração de códigos, expiração, limites por IP e totais.
- `limits.ts` — rate limiting (mensagens por conexão, salas por IP, tentativas de entrada por IP).
- `index.ts` — HTTP (`/health`) e WebSocket, checagem de origem, heartbeat.

### Cliente
- `OnlineGame` (novo): reaproveita `render/scene`, mesa, taco e `Hud`. Em vez de simular, aplica os `snapshot` do servidor com interpolação e envia `tacada` e `posicionar_branca`.
- `Game.ts` (modo IA) **não é alterado**. O `soak.test.ts` continua sendo a rede de segurança dele.

## Ciclo da sala
`aguardando` (1 jogador) → `jogando` (2 jogadores) → `fim`. Após o fim, `revanche` reinicia a mesma sala. Quem cria a sala joga primeiro; a mesa começa aberta.

## Protocolo
Cliente → servidor:
- `criar_sala { apelido }`
- `entrar_sala { codigo, apelido }`
- `reconectar { codigo, token }`
- `tacada { angulo, forca }`
- `posicionar_branca { x, y }` (após falta)
- `revanche`
- `sair`

Servidor → cliente:
- `sala { codigo, assentos, voce, token }` (o `token` só vai para o dono do assento)
- `estado { turno, grupos, encacapadas, mensagem, vencedor, fase }` (alimenta o HUD existente)
- `snapshot { bolas[] }` a cerca de 30 Hz, apenas enquanto as bolas rolam
- `erro { codigo }` com códigos genéricos

### Reconexão
Cada jogador recebe um token de assento. Se a conexão cair, a sala espera 60 s. Voltando com o token, o jogador retoma a partida; caso contrário, o adversário vence por W.O.

## Segurança (requisito, não opcional)
O servidor nunca confia no cliente.

- **Validação de mensagens:** payload máximo de 1 KB; formato checado em tempo de execução; tipos desconhecidos ou malformados descartados; números precisam ser finitos; `forca` limitada a [0, 1]; `angulo` normalizado; `posicionar_branca` passa novamente por `clampCuePlacement` no servidor.
- **Turno e fase:** só o jogador da vez atira, e só na fase de mira. Tacada fora de hora é ignorada.
- **Origem do WebSocket:** o upgrade só é aceito com `Origin: https://sinuca.guidev.site` (configurável por `ALLOWED_ORIGIN`), bloqueando sequestro de WebSocket entre sites.
- **Limites anti-abuso:** mensagens por segundo por conexão; máximo de salas por IP e no total; tentativas de "entrar com código" por IP; expiração de salas ociosas; ping/pong para derrubar conexões mortas.
- **Tokens e códigos:** token de assento com 128 bits via `crypto.randomBytes`, nunca enviado ao adversário. Código de sala com 6 caracteres de um alfabeto sem ambiguidade (sem `0/O`, `1/I/L`); o limite de tentativas por IP inviabiliza adivinhar salas.
- **Apelidos:** 2 a 16 caracteres, caracteres de controle removidos, exibidos apenas como texto do React (sem `innerHTML`), sem XSS.
- **CPU do servidor:** número máximo de passos de física por ciclo, para que uma sala não trave as outras.
- **Infra:** container como usuário não-root; porta não publicada no host (acesso só via Traefik); dependências com versão fixa; `npm audit` sem vulnerabilidades altas ou críticas antes do deploy; erros genéricos, sem stack trace ao cliente.
- **Pressuposto registrado:** o IP real do cliente vem de `CF-Connecting-IP`. Isso só é confiável porque o servidor não é acessível diretamente, apenas atrás do Traefik e do Cloudflare. Se essa exposição mudar, o cabeçalho deixa de ser confiável.

## Testes (Vitest)
- **Unitários do servidor:** validação (aceita válidas; rejeita formato errado, `NaN`, força fora da faixa, payload grande); ciclo da sala (criar, entrar, sala cheia, código inexistente); checagem de turno e fase; reconexão com token certo e errado; W.O. após 60 s com relógio falso; limites de taxa e de salas por IP.
- **Integração:** servidor real, dois clientes `ws` jogando uma partida curta até o fim; teste de segurança confirmando que origem não permitida é recusada.
- **Física e regras:** testes existentes seguem passando sem mudança.
- **Visual:** verificado abrindo duas abas e jogando uma partida.

## Erros
- Queda de conexão: cliente mostra "reconectando…", tenta de novo com espera crescente e retoma com o token.
- Sala cheia, inexistente ou expirada: mensagem clara e volta ao menu.
- Servidor reiniciado: salas em memória são perdidas; o cliente avisa "a sala foi encerrada". Aceitável na etapa 1.

## Deploy (Dokploy)
- App novo `sinuca-server` no projeto Sinuca: Dockerfile próprio (Node 22, não-root, build com esbuild).
- Regra de caminho no domínio `sinuca.guidev.site`: `/socket` → `sinuca-server`; restante → Next.
- Variável `ALLOWED_ORIGIN=https://sinuca.guidev.site`; nenhum segredo no repositório.
- Antes de liberar, testar o WebSocket de ponta a ponta pelo domínio, passando pelo Cloudflare.
- Deploy automático continua desligado; publicação só quando o dono pedir.
- As variáveis `NIXPACKS_NODE_VERSION=22` e `NODE_OPTIONS=--experimental-require-module` já configuradas no app Next precisam ser mantidas.

## Fora do escopo desta etapa
Contas e login, banco de dados, ranking, matchmaking, chat, espectadores, sons e spin.
