import { startServer } from "./index";

const port = Number(process.env.PORT ?? 8787);
const allowedOrigin = process.env.ALLOWED_ORIGIN ?? "https://sinuca.guidev.site";

const srv = await startServer({ port, allowedOrigin });
console.log(`servidor ouvindo na porta ${srv.port}`);

let closing = false;
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
