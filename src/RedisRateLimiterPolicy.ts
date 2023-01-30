import {
  EventEmitter,
  FailureReason,
  IDefaultPolicyContext,
  IPolicy,
  ISuccessEvent,
  IFailureEvent,
  Policy,
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

export interface ICircuitBreakerOptions {
  halfOpenAfter: number;
  hash: string;
  maxWindowRequestCount: Number;
  intervalInSeconds: Number;
}

export class RedisRateLimiterPolicy implements IPolicy {
  declare readonly _altReturn: never;

  /**
   * @inheritdoc
   */
  public readonly onSuccess = this.executor.onSuccess;

  /**
   * @inheritdoc
   */
  public readonly onFailure = this.executor.onFailure;

  constructor(
    private readonly options: ICircuitBreakerOptions,
    private readonly executor: ExecuteWrapper
  ) {}

  public async execute<T>(
    fn: (context: IDefaultPolicyContext) => PromiseLike<T> | T,
    signal = neverAbortedSignal
  ): Promise<T> {
    const rateLimitStatus = await rateLimitExceeded(
      this.options.hash,
      this.options.maxWindowRequestCount,
      this.options.intervalInSeconds
    );

    if (rateLimitStatus) {
      throw new Error(`Rate Limit Exceded`);
    }
    const result = await this.executor.invoke(fn, { signal });
    return returnOrThrow(result);
  }
}

export function redisRateLimiter(
  policy: Policy,
  opts: {
    halfOpenAfter: number;
    hash: string;
    maxWindowRequestCount: Number;
    intervalInSeconds: Number;
  }
) {
  return new RedisRateLimiterPolicy(
    opts,
    new ExecuteWrapper(policy.options.errorFilter, policy.options.resultFilter)
  );
}

async function rateLimitExceeded(
  hash: string,
  maxWindowRequestCount: Number = 5,
  intervalInSeconds: Number = 1 * 60
): Promise<Boolean> {
  const MAX_WINDOW_REQUEST_COUNT = maxWindowRequestCount;
  const WINDOW_LOG_INTERVAL_IN_SECONDS: Number = intervalInSeconds;
  const record = await redis.get(hash);
  const currentRequestTime = moment();

  if (!record) {
    let newRecord = [];
    let requestLog = {
      requestTimeStamp: currentRequestTime.unix(),
      requestCount: 1,
    };
    newRecord.push(requestLog);
    await redis.set(
      hash,
      JSON.stringify(newRecord),
      "EX",
      Number(WINDOW_LOG_INTERVAL_IN_SECONDS)
    );
    return false;
  }
  // if record is found, parse it's value and calculate number of requests users has made within the last window
  let data = JSON.parse(record);
  let windowStartTimestamp = moment()
    .subtract(`${WINDOW_LOG_INTERVAL_IN_SECONDS}`, "seconds")
    .unix();

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
      .subtract(`${WINDOW_LOG_INTERVAL_IN_SECONDS}`, "seconds")
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
    const expirationTime = await redis.ttl(hash);
    await redis.set(hash, JSON.stringify(data), "EX", expirationTime);
    return false;
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
    try {
      const value = await fn(...args);
      if (!this.resultFilter(value)) {
        return { success: value };
      }

      return { value };
    } catch (rawError) {
      const error = rawError as Error;
      const handled = this.errorFilter(error as Error);

      if (!handled) {
        throw error;
      }

      return { error };
    }
  }
}
