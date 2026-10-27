/**
 * One battle on screen: the simulation state, the clock (SIM-02) and the action queue.
 * The interface queues actions; they are applied at the start of the next tick (SIM-10).
 * Phaser's update() drives advance(): when the game loop sleeps (the menu, a hidden tab,
 * frame-by-frame video capture), the battle does not move either (SIM-03).
 */

import { config } from '../config';
import {
  createBattle,
  step,
  type Action,
  type BattleEvent,
  type BattleSetup,
  type BattleState,
} from '../sim';

export type TickListener = (events: readonly BattleEvent[], state: BattleState) => void;

export class BattleSession {
  readonly state: BattleState;
  /** A window is open or the player left (YG-04): the clock stands. */
  paused = false;
  /** DEV-02: tests stop the clock and advance it tick by tick. */
  timeStopped = false;
  /** DEV-02: clock speed. */
  speed = 1;
  /** The opponent (a bot or a replayed record — Stage 1) adds actions right before every tick. */
  driver: ((state: BattleState) => Action[]) | null = null;
  private acc = 0;
  private pending: Action[] = [];
  private readonly listeners: TickListener[] = [];

  constructor(readonly setup: BattleSetup) {
    this.state = createBattle(setup);
  }

  onTick(cb: TickListener): void {
    this.listeners.push(cb);
  }

  queue(...actions: Action[]): void {
    this.pending.push(...actions);
  }

  /** Drops queued actions: a card played just before a pause must not land after it. */
  clearPending(): void {
    this.pending = [];
  }

  /** SIM-02: whole ticks from real time, at most maxTicksPerFrame; the rest is dropped. */
  advance(ms: number): void {
    if (this.paused || this.timeStopped) {
      this.acc = 0;
      return;
    }
    this.acc += ms * this.speed;
    let n = Math.floor(this.acc / config.tickMs);
    this.acc -= n * config.tickMs;
    const cap = config.maxTicksPerFrame * Math.max(1, this.speed);
    if (n > cap) {
      n = cap;
      this.acc = 0;
    }
    for (let i = 0; i < n; i++) this.tick();
  }

  /** Part of the current tick already elapsed, 0…1, for smooth drawing. */
  tickProgress(): number {
    return this.paused || this.timeStopped ? 0 : Math.min(1, this.acc / config.tickMs);
  }

  tick(): void {
    if (this.state.phase === 'ended') return;
    if (this.driver) this.pending.push(...this.driver(this.state));
    const actions = this.pending;
    this.pending = [];
    this.emit(step(this.state, actions));
  }

  private emit(events: readonly BattleEvent[]): void {
    for (const cb of this.listeners) cb(events, this.state);
  }
}
