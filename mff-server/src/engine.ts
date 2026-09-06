// ============================================================================
// Versão HEADLESS do motor de partida (sem canvas, sem DOM).
// Adaptado de src/game/engine.ts do app original: a diferença central é que
// updateBotAI() foi substituída por um segundo conjunto de inputs reais
// (playerA e playerB), exatamente como o comentário no arquivo original já
// sugeria como ponto de extensão.
// ============================================================================

export const FIELD = {
  width: 1000,
  height: 580,
  wallPad: 26,
  goalWidth: 190,
  goalDepth: 20,
};

interface Vec {
  x: number;
  y: number;
}

export interface PlayerInput {
  moveX: number;
  moveY: number;
  moveMagnitude: number;
  sprint: boolean;
  shoot: boolean;
  tackle: boolean;
}

interface PlayerState extends Vec {
  vx: number;
  vy: number;
  facing: Vec;
  radius: number;
  sprinting: boolean;
  sliding: boolean;
  slideTimer: number;
  tackleCooldownMs: number;
  stamina: number;
  side: "home" | "away";
}

interface BallState extends Vec {
  vx: number;
  vy: number;
  radius: number;
  spin: number;
}

export interface MatchState {
  home: { x: number; y: number; facing: Vec; sprinting: boolean; sliding: boolean };
  away: { x: number; y: number; facing: Vec; sprinting: boolean; sliding: boolean };
  ball: { x: number; y: number; spin: number };
  homeScore: number;
  awayScore: number;
  timeLeft: number;
}

const BASE_SPEED = 235;
const SPRINT_SPEED = 370;
const STAMINA_MAX = 100;
const TACKLE_COOLDOWN_MS = 1700;
// Atrito da bola expresso "por segundo" (não por tick), para que a física não
// mude de sensação se a taxa de tick do servidor for ajustada.
// 0.986^20 ≈ decaimento equivalente ao valor antigo a 20 ticks/s.
const BALL_FRICTION_PER_SECOND = 0.756;

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
function dist(a: Vec, b: Vec) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function normalize(v: Vec): Vec {
  const len = Math.hypot(v.x, v.y);
  if (len < 1e-6) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

export class HeadlessMatchEngine {
  private home: PlayerState;
  private away: PlayerState;
  private ball: BallState;

  private homeInput: PlayerInput = { moveX: 0, moveY: 0, moveMagnitude: 0, sprint: false, shoot: false, tackle: false };
  private awayInput: PlayerInput = { moveX: 0, moveY: 0, moveMagnitude: 0, sprint: false, shoot: false, tackle: false };

  private homeScore = 0;
  private awayScore = 0;
  private timeLeft: number;
  private ended = false;

  constructor(durationSeconds: number) {
    this.timeLeft = durationSeconds;
    this.home = this.makePlayer("home", FIELD.width * 0.25, { x: 1, y: 0 });
    this.away = this.makePlayer("away", FIELD.width * 0.75, { x: -1, y: 0 });
    this.ball = { x: FIELD.width / 2, y: FIELD.height / 2, vx: 0, vy: 0, radius: 11, spin: 0 };
  }

  private makePlayer(side: "home" | "away", x: number, facing: Vec): PlayerState {
    return {
      x,
      y: FIELD.height / 2,
      vx: 0,
      vy: 0,
      facing,
      radius: 20,
      sprinting: false,
      sliding: false,
      slideTimer: 0,
      tackleCooldownMs: 0,
      stamina: STAMINA_MAX,
      side,
    };
  }

  setInput(side: "home" | "away", input: PlayerInput) {
    if (side === "home") this.homeInput = input;
    else this.awayInput = input;

    // shoot/tackle são "edge-triggered" no cliente; tratamos aqui a cada
    // mensagem recebida, então disparamos direto em vez de guardar estado.
    if (input.shoot) this.tryShoot(side === "home" ? this.home : this.away);
    if (input.tackle) this.tryTackle(side === "home" ? this.home : this.away);
  }

  private tryShoot(p: PlayerState) {
    if (this.ended) return;
    const kickRange = p.radius + this.ball.radius + 22;
    if (dist(p, this.ball) <= kickRange) {
      const input = p.side === "home" ? this.homeInput : this.awayInput;
      const dir = input.moveMagnitude > 0.15 ? normalize({ x: input.moveX, y: input.moveY }) : p.facing;
      const power = 640;
      this.ball.vx = dir.x * power;
      this.ball.vy = dir.y * power;
    }
  }

  private tryTackle(p: PlayerState) {
    if (this.ended) return;
    if (p.tackleCooldownMs > 0) return;
    p.sliding = true;
    p.slideTimer = 260;
    p.tackleCooldownMs = TACKLE_COOLDOWN_MS;
  }

  private resetPositions() {
    this.home.x = FIELD.width * 0.25;
    this.home.y = FIELD.height / 2;
    this.home.vx = 0;
    this.home.vy = 0;
    this.away.x = FIELD.width * 0.75;
    this.away.y = FIELD.height / 2;
    this.away.vx = 0;
    this.away.vy = 0;
    this.ball.x = FIELD.width / 2;
    this.ball.y = FIELD.height / 2;
    this.ball.vx = 0;
    this.ball.vy = 0;
  }

  // Chamado pelo game loop do servidor (setInterval) — dt em segundos.
  tick(dt: number): { ended: boolean; goal: "home" | "away" | null } {
    if (this.ended) return { ended: true, goal: null };

    this.timeLeft = Math.max(0, this.timeLeft - dt);
    this.updatePlayer(this.home, this.homeInput, dt);
    this.updatePlayer(this.away, this.awayInput, dt);
    const goal = this.updateBall(dt);

    if (this.timeLeft <= 0) {
      this.ended = true;
    }
    return { ended: this.ended, goal };
  }

  private updatePlayer(p: PlayerState, input: PlayerInput, dt: number) {
    const canSprint = input.sprint && p.stamina > 0 && input.moveMagnitude > 0.1;
    p.sprinting = canSprint;
    if (canSprint) p.stamina = clamp(p.stamina - dt * 42, 0, STAMINA_MAX);
    else p.stamina = clamp(p.stamina + dt * 22, 0, STAMINA_MAX);

    const speed = (canSprint ? SPRINT_SPEED : BASE_SPEED) * input.moveMagnitude;
    const dir = normalize({ x: input.moveX, y: input.moveY });
    if (input.moveMagnitude > 0.1) p.facing = dir;

    if (p.sliding) {
      p.slideTimer -= dt * 1000;
      const slideSpeed = 560;
      p.vx = p.facing.x * slideSpeed;
      p.vy = p.facing.y * slideSpeed;
      if (p.slideTimer <= 0) p.sliding = false;
    } else {
      p.vx = dir.x * speed;
      p.vy = dir.y * speed;
    }
    if (p.tackleCooldownMs > 0) p.tackleCooldownMs = Math.max(0, p.tackleCooldownMs - dt * 1000);

    p.x = clamp(p.x + p.vx * dt, FIELD.wallPad + p.radius, FIELD.width - FIELD.wallPad - p.radius);
    p.y = clamp(p.y + p.vy * dt, FIELD.wallPad + p.radius, FIELD.height - FIELD.wallPad - p.radius);

    this.resolvePlayerBallCollision(p);
  }

  private resolvePlayerBallCollision(p: PlayerState) {
    const ball = this.ball;
    const d = dist(p, ball);
    const minDist = p.radius + ball.radius;
    if (d < minDist) {
      const dir = normalize({ x: ball.x - p.x, y: ball.y - p.y }) || { x: 1, y: 0 };
      const overlap = minDist - d;
      ball.x += dir.x * overlap;
      ball.y += dir.y * overlap;

      const impactSpeed = p.sliding ? 480 : 130;
      ball.vx = dir.x * impactSpeed + p.vx * 0.35;
      ball.vy = dir.y * impactSpeed + p.vy * 0.35;
    }
  }

  private updateBall(dt: number): "home" | "away" | null {
    const ball = this.ball;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    const friction = Math.pow(BALL_FRICTION_PER_SECOND, dt);
    ball.vx *= friction;
    ball.vy *= friction;
    ball.spin += Math.hypot(ball.vx, ball.vy) * dt * 0.02;

    const top = FIELD.wallPad + ball.radius;
    const bottom = FIELD.height - FIELD.wallPad - ball.radius;
    const left = FIELD.wallPad + ball.radius;
    const right = FIELD.width - FIELD.wallPad - ball.radius;

    const goalTop = FIELD.height / 2 - FIELD.goalWidth / 2;
    const goalBottom = FIELD.height / 2 + FIELD.goalWidth / 2;
    // Antes isto comparava só o CENTRO da bola com o vão do gol. Se o centro
    // ficasse a menos de um raio de distância da trave (bola visualmente já
    // entrando pelo vão), a checagem dava "false" e a bola batia na parede
    // lateral do campo em vez de entrar — um dos motivos do gol não contar.
    const insideGoalMouth = ball.y + ball.radius > goalTop && ball.y - ball.radius < goalBottom;

    if (ball.y < top) {
      ball.y = top;
      ball.vy *= -0.72;
    } else if (ball.y > bottom) {
      ball.y = bottom;
      ball.vy *= -0.72;
    }

    if (!insideGoalMouth) {
      if (ball.x < left) {
        ball.x = left;
        ball.vx *= -0.72;
      } else if (ball.x > right) {
        ball.x = right;
        ball.vx *= -0.72;
      }
    } else {
      // Antes o gol só contava quando a bola cruzava TODA a profundidade da
      // rede (até -goalDepth-radius). Com o atrito (0.986/tick) reduzindo a
      // velocidade a cada tick, uma bola que entrava mais devagar perdia
      // força e podia parar dentro da rede sem nunca alcançar esse ponto —
      // ou seja, entrava visualmente e não contava. Agora o gol conta assim
      // que a bola INTEIRA cruza a linha do gol (regra do gol-linha real),
      // e ela ainda pode continuar entrando na rede visualmente depois disso.
      const goalLineLeft = FIELD.wallPad;
      const goalLineRight = FIELD.width - FIELD.wallPad;
      const netBackLeft = -FIELD.goalDepth - ball.radius;
      const netBackRight = FIELD.width + FIELD.goalDepth + ball.radius;

      // Segura a bola dentro da rede (efeito visual), sem deixá-la sumir do mapa.
      if (ball.x < netBackLeft) {
        ball.x = netBackLeft;
        ball.vx *= -0.4;
      } else if (ball.x > netBackRight) {
        ball.x = netBackRight;
        ball.vx *= -0.4;
      }

      if (ball.x + ball.radius < goalLineLeft) {
        this.awayScore += 1;
        this.resetPositions();
        return "away";
      } else if (ball.x - ball.radius > goalLineRight) {
        this.homeScore += 1;
        this.resetPositions();
        return "home";
      }
    }
    return null;
  }

  getState(): MatchState {
    return {
      home: { x: this.home.x, y: this.home.y, facing: this.home.facing, sprinting: this.home.sprinting, sliding: this.home.sliding },
      away: { x: this.away.x, y: this.away.y, facing: this.away.facing, sprinting: this.away.sprinting, sliding: this.away.sliding },
      ball: { x: this.ball.x, y: this.ball.y, spin: this.ball.spin },
      homeScore: this.homeScore,
      awayScore: this.awayScore,
      timeLeft: this.timeLeft,
    };
  }
}
