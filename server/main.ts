import { startServer } from "./index";

const rawPort = process.env.PORT;
const port = rawPort === undefined ? 8787 : /^\d+$/.test(rawPort) ? Number(rawPort) : NaN;
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`PORT inválida: esperado inteiro entre 1 e 65535 (recebido "${rawPort}")`);
  process.exit(1);
}
const allowedOrigin = process.env.ALLOWED_ORIGIN ?? "https://sinuca.guidev.site";

let closing = false;
startServer({ port, allowedOrigin }).then(
  (srv) => {
    console.log(`servidor ouvindo na porta ${srv.port}`);
    const shutdown = (): void => {
      if (closing) return;
      closing = true;
      srv.close().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  },
  () => {
    console.error("falha ao iniciar o servidor");
    process.exit(1);
  },
);
