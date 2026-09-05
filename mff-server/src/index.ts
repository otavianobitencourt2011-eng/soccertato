import express from "express";
import { createServer } from "http";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { MatchRoom } from "./MatchRoom.js";

const port = Number(process.env.PORT) || 2567;

const app = express();
const httpServer = createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

// Cada partida vira uma "room" independente, identificada por matchId.
// joinOrCreate("match", { matchId, clubId }) do lado do cliente cai aqui.
gameServer.define("match", MatchRoom);

app.get("/", (_req, res) => {
  res.send("MamoBall match server rodando.");
});

httpServer.listen(port, () => {
  console.log(`Servidor de partidas ouvindo na porta ${port}`);
});
