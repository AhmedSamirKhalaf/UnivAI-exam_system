import { createServer } from "node:http";
import next from "next";
import { attachIntegrityWebSocketServer } from "./src/lib/integrity-socket";

const mode = process.argv[2] ?? "dev";
const dev = mode !== "start";
const hostname = process.env.EXAM_HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 3200);

async function main(): Promise<void> {
  const app = next({ dev, hostname, port });
  await app.prepare();
  const requestHandler = app.getRequestHandler();
  const upgradeHandler = app.getUpgradeHandler();

  const server = createServer((request, response) => {
    void requestHandler(request, response);
  });

  attachIntegrityWebSocketServer(server, upgradeHandler);

  server.listen(port, hostname, () => {
    console.log(`UnivAI Exams listening on http://${hostname}:${port}`);
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
