import {
  IBreaker,
  EventEmitter,
  BrokenCircuitError,
  TaskCancelledError,
  IsolatedCircuitError,
  FailureReason,
  IDefaultPolicyContext,
  IPolicy,
  Policy,
  ISuccessEvent,
  IFailureEvent,
} from "cockatiel";
import * as moment from "moment";
import Redis from "ioredis";
const redis = new Redis();

export type FailureOrSuccess<R> = FailureReason<R> | { success: R };

export const returnOrThrow = <R>(failure: FailureOrSuccess<R>) => {
  if ("error" in failure) {
    throw failure.error;
  }

  if ("success" in failure) {
    return failure.success;
  }

  return failure.value;
};

export const neverAbortedSignal = new AbortController().signal;

export enum CircuitState {
  /**
   * Normal operation. Execution of actions allowed.
   */
  Closed,

  /**
   * The automated controller has opened the circuit. Execution of actions blocked.
   */
  Open,

  /**
   * Recovering from open state, after the automated break duration has
   * expired. Execution of actions permitted. Success of subsequent action/s
   * controls onward transition to Open or Closed state.
   */
  HalfOpen,

  /**
   * Circuit held manually in an open state. Execution of actions blocked.
   */
  Isolated,
}

export interface ICircuitBreakerOptions {
  breaker: IBreaker;
  halfOpenAfter: number;
  ip: string;
  maxWindowRequestCount: Number;
  intervalInMinutes: Number;
}

type InnerState =
  | { value: CircuitState.Closed }
  | { value: CircuitState.Isolated; counters: number }
  | { value: CircuitState.Open; openedAt: number }
  | { value: CircuitState.HalfOpen; test: Promise<any> };

export class RedisRateLimiterPolicy implements IPolicy {
  declare readonly _altReturn: never;

  private readonly breakEmitter = new EventEmitter<
    FailureReason<unknown> | { isolated: true }
  >();
  private readonly resetEmitter = new EventEmitter<void>();
  private readonly halfOpenEmitter = new EventEmitter<void>();
  private readonly stateChangeEmitter = new EventEmitter<CircuitState>();
  private innerLastFailure?: FailureReason<unknown>;
  private innerState: InnerState = { value: CircuitState.Closed };

  /**
   * Event emitted when the circuit breaker opens.
   */
  public readonly onBreak = this.breakEmitter.addListener;

  /**
   * Event emitted when the circuit breaker resets.
   */
  public readonly onReset = this.resetEmitter.addListener;

  /**
   * Event emitted when the circuit breaker is half open (running a test call).
   * Either `onBreak` on `onReset` will subsequently fire.
   */
  public readonly onHalfOpen = this.halfOpenEmitter.addListener;

  /**
   * Fired whenever the circuit breaker state changes.
   */
  public readonly onStateChange = this.stateChangeEmitter.addListener;

  /**
   * @inheritdoc
   */
  public readonly onSuccess = this.executor.onSuccess;

  /**
   * @inheritdoc
   */
  public readonly onFailure = this.executor.onFailure;

  /**
   * Gets the current circuit breaker state.
   */
  public get state(): CircuitState {
    return this.innerState.value;
  }

  /**
   * Gets the last reason the circuit breaker failed.
   */
  public get lastFailure() {
    return this.innerLastFailure;
  }

  constructor(
    private readonly options: ICircuitBreakerOptions,
    private readonly executor: ExecuteWrapper
  ) {}

  /**
   * Manually holds open the circuit breaker.
   * @returns A handle that keeps the breaker open until `.dispose()` is called.
   */
  public isolate() {
    if (this.innerState.value !== CircuitState.Isolated) {
      this.innerState = { value: CircuitState.Isolated, counters: 0 };
      this.breakEmitter.emit({ isolated: true });
      this.stateChangeEmitter.emit(CircuitState.Isolated);
    }

    this.innerState.counters++;

    let disposed = false;
    return {
      dispose: () => {
        if (disposed) {
          return;
        }

        disposed = true;
        if (
          this.innerState.value === CircuitState.Isolated &&
          !--this.innerState.counters
        ) {
          this.innerState = { value: CircuitState.Closed };
          this.resetEmitter.emit();
          this.stateChangeEmitter.emit(CircuitState.Closed);
        }
      },
    };
  }

  /**
   * Executes the given function.
   * @param fn Function to run
   * @throws a {@link BrokenCircuitError} if the circuit is open
   * @throws a {@link IsolatedCircuitError} if the circuit is held
   * open via {@link RedisRateLimiterPolicy.isolate}
   * @returns a Promise that resolves or rejects with the function results.
   */
  public async execute<T>(
    fn: (context: IDefaultPolicyContext) => PromiseLike<T> | T,
    signal = neverAbortedSignal
  ): Promise<T> {
    const state = this.innerState;
    switch (state.value) {
      case CircuitState.Closed:
        const result = await this.executor.invoke(fn, { signal });
        const rateLimitStatus = await rateLimitExceeded(this.options.ip,this.options.maxWindowRequestCount,this.options.intervalInMinutes);
        if (rateLimitStatus) {
          this.stateChangeEmitter.emit(CircuitState.Open);
          throw new Error(`Rate Limit Exceded`);
        }
        if ("success" in result) {
          this.options.breaker.success(state.value);
        } else {
          this.innerLastFailure = result;
          if (this.options.breaker.failure(state.value)) {
            this.open(result);
          }
        }
        //throw new BrokenCircuitError();
        return returnOrThrow(result);

      case CircuitState.HalfOpen:
        await state.test.catch(() => undefined);
        if (this.state === CircuitState.Closed && signal.aborted) {
          throw new TaskCancelledError();
        }

        return this.execute(fn);

      case CircuitState.Open:
        if (Date.now() - state.openedAt < this.options.halfOpenAfter) {
          throw new BrokenCircuitError();
        }
        const test = this.halfOpen(fn, signal);
        this.innerState = { value: CircuitState.HalfOpen, test };
        this.stateChangeEmitter.emit(CircuitState.HalfOpen);
        return test;

      case CircuitState.Isolated:
        throw new IsolatedCircuitError();

      default:
        throw new Error(`Unexpected circuit state ${state}`);
    }
  }

  private async halfOpen<T>(
    fn: (context: IDefaultPolicyContext) => PromiseLike<T> | T,
    signal: AbortSignal
  ): Promise<T> {
    this.halfOpenEmitter.emit();

    try {
      const result = await this.executor.invoke(fn, { signal });
      if ("success" in result) {
        this.options.breaker.success(CircuitState.HalfOpen);
        this.close();
      } else {
        this.innerLastFailure = result;
        this.options.breaker.failure(CircuitState.HalfOpen);
        this.open(result);
      }

      return returnOrThrow(result);
    } catch (err) {
      // It's an error, but not one the circuit is meant to retry, so
      // for our purposes it's a success. Task failed successfully!
      this.close();
      throw err;
    }
  }

  private open(reason: FailureReason<unknown>) {
    if (
      this.state === CircuitState.Isolated ||
      this.state === CircuitState.Open
    ) {
      return;
    }

    this.innerState = { value: CircuitState.Open, openedAt: Date.now() };
    this.breakEmitter.emit(reason);
    this.stateChangeEmitter.emit(CircuitState.Open);
  }

  private close() {
    if (this.state === CircuitState.HalfOpen) {
      this.innerState = { value: CircuitState.Closed };
      this.resetEmitter.emit();
      this.stateChangeEmitter.emit(CircuitState.Closed);
    }
  }
}

export class ExecuteWrapper {
  private readonly successEmitter = new EventEmitter<ISuccessEvent>();
  private readonly failureEmitter = new EventEmitter<IFailureEvent>();
  public readonly onSuccess = this.successEmitter.addListener;
  public readonly onFailure = this.failureEmitter.addListener;

  constructor(
    private readonly errorFilter: (error: Error) => boolean = () => false,
    private readonly resultFilter: (result: unknown) => boolean = () => false
  ) {}

  public clone() {
    return new ExecuteWrapper(this.errorFilter, this.resultFilter);
  }

  public async invoke<T extends unknown[], R>(
    fn: (...args: T) => PromiseLike<R> | R,
    ...args: T
  ): Promise<FailureOrSuccess<R>> {
    const stopwatch =
      this.successEmitter.size || this.failureEmitter.size
        ? makeStopwatch()
        : null;

    try {
      const value = await fn(...args);
      if (!this.resultFilter(value)) {
        if (stopwatch) {
          this.successEmitter.emit({ duration: stopwatch() });
        }
        return { success: value };
      }

      if (stopwatch) {
        this.failureEmitter.emit({
          duration: stopwatch(),
          handled: true,
          reason: { value },
        });
      }

      return { value };
    } catch (rawError) {
      const error = rawError as Error;
      const handled = this.errorFilter(error as Error);
      if (stopwatch) {
        this.failureEmitter.emit({
          duration: stopwatch(),
          handled,
          reason: { error },
        });
      }

      if (!handled) {
        throw error;
      }

      return { error };
    }
  }
}

declare const performance: { now(): number };

const makeStopwatch = () => {
  if (typeof performance !== "undefined") {
    const start = performance.now();
    return () => performance.now() - start;
  } else {
    const start = process.hrtime.bigint();
    return () => Number(process.hrtime.bigint() - start) / 1000000; // ns->ms
  }
};

export function redisRateLimiter(
  policy: Policy,
  opts: { halfOpenAfter: number; breaker: IBreaker; ip: string,maxWindowRequestCount: Number,intervalInMinutes: Number }
) {
  return new RedisRateLimiterPolicy(
    opts,
    new ExecuteWrapper(policy.options.errorFilter, policy.options.resultFilter)
  );
}

async function rateLimitExceeded(ip: string,maxWindowRequestCount: Number=5,intervalInMinutes: Number=1): Promise<Boolean> {
  const MAX_WINDOW_REQUEST_COUNT = maxWindowRequestCount;
  const WINDOW_LOG_INTERVAL_IN_MINUTE = intervalInMinutes;
  const record = await redis.get(ip);
  const currentRequestTime = moment();
  if (!record) {
    let newRecord = [];
    let requestLog = {
      requestTimeStamp: currentRequestTime.unix(),
      requestCount: 1,
    };
    newRecord.push(requestLog);
    await redis.set(ip, JSON.stringify(newRecord));
    return false;
  }
  // if record is found, parse it's value and calculate number of requests users has made within the last window
  let data = JSON.parse(record);
  
  let windowStartTimestamp = moment().subtract(`${WINDOW_LOG_INTERVAL_IN_MINUTE}`, "minutes").unix();
  let requestsWithinWindow = data.filter((entry: any) => {
    return entry.requestTimeStamp > windowStartTimestamp;
  });

  let totalWindowRequestsCount = requestsWithinWindow.reduce(
    (accumulator: any, entry: any) => {
      return accumulator + entry.requestCount;
    },
    0
  );

  // if number of requests made is greater than or equal to the desired maximum, return error
  
  if (totalWindowRequestsCount >= MAX_WINDOW_REQUEST_COUNT) {
    return true;
  } else {
    // if number of requests made is less than allowed maximum, log new entry
    let lastRequestLog = data[data.length - 1];
    
    let potentialCurrentWindowIntervalStartTimeStamp = currentRequestTime
      .subtract(`${WINDOW_LOG_INTERVAL_IN_MINUTE}`, "minutes")
      .unix();
    //  if interval has not passed since last request log, increment counter
    if (
      lastRequestLog.requestTimeStamp >
      potentialCurrentWindowIntervalStartTimeStamp
    ) {
      lastRequestLog.requestCount++;
      data[data.length - 1] = lastRequestLog;
    } else {
      //  if interval has passed, log new entry for current user and timestamp
      data.push({
        requestTimeStamp: currentRequestTime.unix(),
        requestCount: 1,
      });
    }
    await redis.set(ip, JSON.stringify(data));
    return false;
  }
}
