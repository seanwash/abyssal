import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { SERVER_PORT } from '../shared/constants';
import { initPhysics } from '../shared/physics';
import { DiveRoom } from './DiveRoom';

await initPhysics();

const port = Number(process.env.PORT ?? SERVER_PORT);
const server = new Server({ transport: new WebSocketTransport(), greet: false });
server.define('dive', DiveRoom);
await server.listen(port, '0.0.0.0');
console.log(`Abyssal dive server listening on ws://0.0.0.0:${port}`);
