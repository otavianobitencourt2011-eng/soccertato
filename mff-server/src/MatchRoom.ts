import { Room, Client } from "@colyseus/core";
import { HeadlessMatchEngine, type PlayerInput } from "./engine.js";

const MATCH_DURATION_SECONDS = 90;
const TICK_RATE_MS = 1000 / 20; // 20 ticks/segundo — suficiente para arcade 2D

interface JoinOptions {
  matchId: string;
  clubId: string;
}

export class MatchRoom extends Room {
  maxClients = 2;

  private engine!: HeadlessMatchEngine;
  private sides = new Map<string, "home" | "away">(); // sessionId -> lado
  private loopHandle: ReturnType<typeof setInterval> | null = null;
  private started = false;

  onCreate(_options: JoinOptions) {
    this.engine = new HeadlessMatchEngine(MATCH_DURATION_SECONDS);

    this.onMessage("input", (client, message: PlayerInput) => {
      const side = this.sides.get(client.sessionId);
      if (!side) return;
      this.engine.setInput(side, message);
    });
  }

  onJoin(client: Client, options: JoinOptions) {
    // Primeiro a entrar joga em casa, segundo joga fora.
    const side = this.sides.size === 0 ? "home" : "away";
    this.sides.set(client.sessionId, side);

    client.send("welcome", { side, matchId: options.matchId, clubId: options.clubId });

    // Avisa os dois lados de quantos jogadores estão na sala (tela de espera).
    this.broadcast("lobby", { connected: this.sides.size, needed: 2 });

    if (this.sides.size === 2 && !this.started) {
      this.startMatch();
    }
  }

  onLeave(client: Client) {
    this.sides.delete(client.sessionId);
    this.broadcast("opponent_left", {});
    this.stopLoop();
  }

  private startMatch() {
    this.started = true;
    this.broadcast("match_start", {});

    this.loopHandle = setInterval(() => {
      const dt = TICK_RATE_MS / 1000;
      const { ended, goal } = this.engine.tick(dt);
      const state = this.engine.getState();

      this.broadcast("state", state);
      if (goal) this.broadcast("goal", { scorer: goal, homeScore: state.homeScore, awayScore: state.awayScore });

      if (ended) {
        this.broadcast("match_end", { homeScore: state.homeScore, awayScore: state.awayScore });
        this.stopLoop();
        this.recordResult(state.homeScore, state.awayScore);
      }
    }, TICK_RATE_MS);
  }

  private stopLoop() {
    if (this.loopHandle) {
      clearInterval(this.loopHandle);
      this.loopHandle = null;
    }
  }

  private async recordResult(homeScore: number, awayScore: number) {
    // Grava o placar final no Supabase. A service key fica só aqui no
    // servidor (variável de ambiente), nunca no app cliente.
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      console.warn("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY não configurados — resultado não gravado.");
      return;
    }
    try {
      await fetch(`${url}/rest/v1/match_results`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          room_id: this.roomId,
          home_score: homeScore,
          away_score: awayScore,
          finished_at: new Date().toISOString(),
        }),
      });
    } catch (err) {
      console.error("Falha ao gravar resultado no Supabase:", err);
    }
  }

  onDispose() {
    this.stopLoop();
  }
}
