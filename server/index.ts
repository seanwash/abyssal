import path from "node:path";

import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";

import { SERVER_PORT } from "../shared/constants";
import { DiveRoom } from "./dive-room";
import { clientMiddleware } from "./static";

const port = Number(process.env.PORT ?? SERVER_PORT);
const client = clientMiddleware(path.resolve(import.meta.dirname, "../dist"));
const server = new Server({
  transport: new WebSocketTransport(),
  greet: false,
  express: client
    ? (app) => {
        app.use(client);
      }
    : undefined,
});
server.define("dive", DiveRoom).filterBy(["party"]);
await server.listen(port, "0.0.0.0");
console.log(
  `Abyssal dive server listening on ws://0.0.0.0:${port}${client ? ", serving the built client" : ""}`
);
