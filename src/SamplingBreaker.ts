import { CircuitState } from "cockatiel";
import Redis from "ioredis";
const redis = new Redis();

interface IWindow {
  startedAt: number;
  failures: number;
  successes: number;
}

export interface ISamplingBreakerOptions {
  /**
   * Percentage (from 0 to 1) of requests that need to fail before we'll
   * open the circuit.
   */
  threshold: number;

  /**
   * Length of time over which to sample.
   */
  duration: number;

  /**
   * Minimum number of RPS needed to be able to (potentially) open the circuit.
   * Useful to avoid unnecessarily tripping under low load.
   */
  minimumRps?: number;
}

interface IBreaker {
  /**
   * Called when a call succeeds.
   */
  success(state: CircuitState): void;
  /**
   * Called when a call fails. Returns true if the circuit should open.
   */
  failure(state: CircuitState): Promise<boolean>;
}

export class SamplingBreaker implements IBreaker {
  private readonly threshold: number;
  private readonly minimumRpms: number;
  private readonly duration: number;
  private readonly windowSize: number;

  private windows: IWindow[] = [];
  private currentWindow = 0;
  private currentFailures = 0;
  private currentSuccesses = 0;

  /**
   * SamplingBreaker breaks if more than `threshold` percentage of calls over the
   * last `samplingDuration`, so long as there's at least `minimumRps` (to avoid
   * closing unnecessarily under low RPS).
   */
  constructor({
    threshold,
    duration: samplingDuration,
    minimumRps,
  }: ISamplingBreakerOptions) {
    if (threshold <= 0 || threshold >= 1) {
      throw new RangeError(
        `SamplingBreaker threshold should be between (0, 1), got ${threshold}`
      );
    }

    this.threshold = threshold;

    // at least 5 windows, max 1 second each:
    const windowCount = Math.max(5, Math.ceil(samplingDuration / 1000));
    for (let i = 0; i < windowCount; i++) {
      this.windows.push({ startedAt: 0, failures: 0, successes: 0 });
    }

    this.windowSize = Math.round(samplingDuration / windowCount);
    this.duration = this.windowSize * windowCount;

    if (minimumRps) {
      this.minimumRpms = minimumRps / 1000;
    } else {
      // for our rps guess, set it so at least 5 failures per second
      // are needed to open the circuit
      this.minimumRpms = 5 / (threshold * 1000);
    }
    redis.set("windows", JSON.stringify(this.windows));
    redis.set("windowSize", this.windowSize);
    redis.set("duration", this.duration);
    redis.set("minimumRpms", this.minimumRpms);
    redis.set("currentWindow", 0);
    redis.set("currentFailures", 0);
    redis.set("currentSuccesses", 0);
  }

  /**
   * @inheritdoc
   */
  public success(state: CircuitState) {
    if (state === CircuitState.HalfOpen) {
      this.resetWindows();
    }

    this.push(true);
  }

  /**
   * @inheritdoc
   */
  public async failure(state: CircuitState) {
    this.push(false);

    if (state !== CircuitState.Closed) {
      return true;
    }

    const redisCurrentSuccess = await redis.get("currentSuccesses");
    const currentSuccesses = Number(redisCurrentSuccess);
    const redisCurrentFailures = await redis.get("currentFailures");
    const currentFailures = Number(redisCurrentFailures);

    const total = currentSuccesses + currentFailures;

    // If we don't have enough rps, then the circuit is open.
    // 1. `total / samplingDuration` gets rps
    // 2. We want `rpms < minimumRpms`
    // 3. Simplifies to `total < samplingDuration * minimumRps`
    const redisDuration = await redis.get("duration");
    const duration = Number(redisDuration);
    const redisMinimumRpms = await redis.get("minimumRpms");
    const minimumRpms = Number(redisMinimumRpms);
    if (total < duration * minimumRpms) {
      return false;
    }

    // If we're above threshold, open the circuit
    // 1. `failures / total > threshold`
    // 2. `failures > threshold * total`
    if (currentFailures > this.threshold * total) {
      return true;
    }

    return false;
  }

  private async resetWindows() {
    // this.currentFailures = 0;
    // this.currentSuccesses = 0;
    // for (const window of this.windows) {
    //   window.failures = 0;
    //   window.successes = 0;
    //   window.startedAt = 0;
    // }
    const redisWindows = await redis.get("windows");
    const windows = JSON.parse(redisWindows);
    for (const window of windows) {
      window.failures = 0;
      window.successes = 0;
      window.startedAt = 0;
    }
    redis.set("currentFailures", 0);
    redis.set("currentSuccesses", 0);
    redis.set("windows", JSON.stringify(windows));
  }

  private async rotateWindow(now: number) {
    // const next = (this.currentWindow + 1) % this.windows.length;
    // this.currentFailures -= this.windows[next].failures;
    // this.currentSuccesses -= this.windows[next].successes;
    // const window = (this.windows[next] = {
    //   failures: 0,
    //   successes: 0,
    //   startedAt: now,
    // });
    // this.currentWindow = next;

    // return window;
    const redisWindows = await redis.get("windows");
    const windows = JSON.parse(redisWindows);
    const redisCurrentWindow = await redis.get("currentWindow");
    const currentWindow = Number(redisCurrentWindow);
    const next = (currentWindow + 1) % windows.length;
    const nextFailures = windows[next].failures;
    redis.set("currentFailures", nextFailures - 1);
    const nextSuccesses = windows[next].successes;
    redis.set("currentSuccesses", nextSuccesses - 1);

    const window = (windows[next] = {
      failures: 0,
      successes: 0,
      startedAt: now,
    });

    redis.set("currentWindow", next);

    return window;
  }

  private async push(success: boolean) {
    const now = Date.now();
    const redisWindows = await redis.get("windows");
    const redisCurrentWindow = await redis.get("currentWindow");
    const currentWindow = Number(redisCurrentWindow);
    // // Get the current time period window, advance if necessary
    // let window = this.windows[this.currentWindow];
    // if (now - window.startedAt >= this.windowSize) {
    //   window = this.rotateWindow(now);
    // }

    // // Increment current counts
    // if (success) {
    //   window.successes++;
    //   this.currentSuccesses++;
    // } else {
    //   window.failures++;
    //   this.currentFailures++;
    // }
    // Get the current time period window, advance if necessary
    const windows = JSON.parse(redisWindows);
    let window = windows[currentWindow];
    if (now - window.startedAt >= this.windowSize) {
      window = this.rotateWindow(now);
    }
    const redisNextWindow = await redis.get("currentWindow");
    const nextWindow = Number(redisNextWindow);
    // Increment current counts
    if (success) {
      const window = windows[nextWindow];
      const redisCurrentSuccess = await redis.get("currentSuccesses");
      const currentSuccesses = Number(redisCurrentSuccess);
      window.successes++;
      redis.set("currentSuccesses", currentSuccesses + 1);
    } else {
      const window = windows[nextWindow];
      const redisCurrentFailures = await redis.get("currentFailures");
      const currentFailures = Number(redisCurrentFailures);
      redis.set("currentSuccesses", currentFailures + 1);
      window.failures++;
    }
    redis.set("windows", JSON.stringify(windows));
  }
}
