/**
 * The single clock the shared desktop stage runs on.
 *
 * There used to be two. `SharedStageRenderer.tick` dropped a whole frame whenever
 * less than `1000 / updateRate()` had passed since the previous one, and each actor
 * ran the same check again on its own clock. Both restarted their timer from the
 * frame they had just drawn instead of advancing it, so the leftover time was
 * thrown away every time — and they were compared against different bases (the
 * accumulated clock versus the raw `requestAnimationFrame` timestamp), which made
 * the two disagree about which frames were due.
 *
 * Concretely, on a 144 Hz display asking for 60 updates per second, the discarded
 * remainder meant the render gate opened on every third frame: 48 updates per
 * second, with the per-actor gate then dropping a few more. The arithmetic below
 * is small enough to keep out of the renderer, which matters because it is the
 * part that has to be right, and because it can be tested without a WebGL context.
 */

export interface StageFrameClock {
  /** False until the first frame has been seen; a flag rather than `previousTime === 0`,
   * because 0 is a legitimate rAF timestamp and using it as a sentinel made the first
   * frame start over. */
  started: boolean;
  /** rAF timestamp of the previous frame. */
  previousTime: number;
  /** rAF timestamp of the last frame that was drawn. */
  lastDrawTime: number;
  /** Frame budget carried over from earlier frames, in milliseconds. */
  backlog: number;
  /** Nominal stage time in seconds: one frame interval per drawn frame. */
  elapsed: number;
  /** How many frames have been drawn. */
  drawCount: number;
}

/**
 * Ceiling on the carried backlog. A frame that arrives after a stall — a hidden
 * window, a long task, a breakpoint — must not make the stage draw several frames
 * back to back to catch up; that backlog is dropped instead. It stays well below
 * the animation step ceiling so one post-stall frame is worth one normal frame.
 */
export const MAX_FRAME_BACKLOG_MS = 100;

/** Ceiling on the animation step handed to an actor, so one late frame cannot warp a pose. */
export const MAX_FRAME_DELTA_SECONDS = 0.1;

/** Slack when comparing deadlines that were built by repeated addition. */
const DEADLINE_EPSILON = 1e-6;

/** Relative slack when comparing a carried backlog against a frame interval. */
const DEADLINE_TOLERANCE = 1e-6;

export function createStageFrameClock(): StageFrameClock {
  return { started: false, previousTime: 0, lastDrawTime: 0, backlog: 0, elapsed: 0, drawCount: 0 };
}

export interface StageFrameDecision {
  /** Whether this frame should be drawn. */
  draw: boolean;
  /** Animation time since the previous drawn frame, in seconds. 0 when not drawing. */
  deltaSeconds: number;
  /**
   * Nominal stage time in seconds, advancing by exactly one frame interval per
   * drawn frame. Every actor's schedule is compared against this rather than
   * against the rAF timestamp, so the two limiters cannot disagree.
   */
  clockSeconds: number;
}

/**
 * Decides whether this animation frame draws, and how much animation time it covers.
 *
 * `rate` is the highest rate any actor asked for. The cap is enforced by carrying
 * elapsed milliseconds in a backlog rather than by restarting a timer: at 144 Hz
 * against a 60 Hz cap the backlog runs 20.8, 4.2, 18.1, 1.4, … and the third,
 * fifth, eighth, … frame draws, which averages exactly 60 updates per second.
 * The old "restart on draw" gate drew every third frame instead — 48 per second.
 */
export function advanceStageFrameClock(
  clock: StageFrameClock,
  time: number,
  rate: number
): StageFrameDecision {
  const interval = 1000 / Math.max(1, rate);
  const previousTime = clock.previousTime;
  clock.previousTime = time;

  // The first frame has no budget to carry and nothing to measure a step against.
  if (!clock.started) {
    clock.started = true;
    clock.lastDrawTime = time;
    clock.backlog = 0;
    clock.elapsed = interval / 1000;
    clock.drawCount = 1;
    return { draw: true, deltaSeconds: interval / 1000, clockSeconds: clock.elapsed };
  }

  clock.backlog = Math.min(clock.backlog + Math.max(0, time - previousTime), MAX_FRAME_BACKLOG_MS);
  // The tolerance is what keeps a display at exactly the requested rate from
  // dropping the occasional frame: `time - previousTime` is float arithmetic, and
  // a step that lands a femtosecond short of the interval used to read as "not yet".
  if (clock.backlog + interval * DEADLINE_TOLERANCE < interval) {
    return { draw: false, deltaSeconds: 0, clockSeconds: clock.elapsed };
  }

  // Spend one frame's worth and keep the remainder, so the next deadline stays on
  // the nominal grid instead of sliding later by up to one refresh interval.
  clock.backlog -= interval;
  if (clock.backlog >= interval) clock.backlog = 0;

  const lastDrawTime = clock.lastDrawTime;
  clock.lastDrawTime = time;
  clock.elapsed += interval / 1000;
  clock.drawCount += 1;

  return {
    draw: true,
    deltaSeconds: Math.min(MAX_FRAME_DELTA_SECONDS, Math.max(0, (time - lastDrawTime) / 1000)),
    clockSeconds: clock.elapsed
  };
}

export interface ActorFrameSchedule {
  /** Deadline on the stage clock, in seconds, for this actor's next update. */
  dueTime: number;
  /** Frame time accumulated since the actor last updated, in seconds. */
  pendingSeconds: number;
  /** False until the actor has updated once. */
  started: boolean;
}

export function createActorFrameSchedule(): ActorFrameSchedule {
  return { dueTime: 0, pendingSeconds: 0, started: false };
}

/**
 * Whether an actor updates on this frame, and how much time its animation covers.
 *
 * The stage already runs at the highest rate anyone asked for, so an actor at that
 * rate is due on every drawn frame and needs no second check of its own — which is
 * exactly the duplicate limit that used to drop frames. An actor asking for less
 * than the stage rate (nothing does today; the interface just allows it) is put on
 * the same nominal grid, so 30 fps against a 60 fps stage lands on every second
 * frame instead of drifting.
 */
export function advanceActorFrameSchedule(
  schedule: ActorFrameSchedule,
  clockSeconds: number,
  updateRate: number,
  frameDeltaSeconds: number
): { update: boolean; deltaSeconds: number } {
  const interval = 1 / Math.max(1, updateRate);
  schedule.pendingSeconds = Math.min(
    MAX_FRAME_DELTA_SECONDS,
    schedule.pendingSeconds + Math.max(0, frameDeltaSeconds)
  );

  if (schedule.started && clockSeconds + DEADLINE_EPSILON < schedule.dueTime) {
    return { update: false, deltaSeconds: 0 };
  }

  const deltaSeconds = schedule.pendingSeconds;
  schedule.pendingSeconds = 0;
  schedule.started = true;
  schedule.dueTime = clockSeconds + interval;
  return { update: true, deltaSeconds };
}
