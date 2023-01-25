"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.redisRateLimiter = exports.ExecuteWrapper = exports.RedisRateLimiterPolicy = exports.CircuitState = exports.neverAbortedSignal = exports.returnOrThrow = void 0;
const cockatiel_1 = require("cockatiel");
const moment = require("moment");
const ioredis_1 = require("ioredis");
const redis = new ioredis_1.default();
const returnOrThrow = (failure) => {
    if ("error" in failure) {
        throw failure.error;
    }
    if ("success" in failure) {
        return failure.success;
    }
    return failure.value;
};
exports.returnOrThrow = returnOrThrow;
exports.neverAbortedSignal = new AbortController().signal;
var CircuitState;
(function (CircuitState) {
    CircuitState[CircuitState["Closed"] = 0] = "Closed";
    CircuitState[CircuitState["Open"] = 1] = "Open";
    CircuitState[CircuitState["HalfOpen"] = 2] = "HalfOpen";
    CircuitState[CircuitState["Isolated"] = 3] = "Isolated";
})(CircuitState = exports.CircuitState || (exports.CircuitState = {}));
class RedisRateLimiterPolicy {
    get state() {
        return this.innerState.value;
    }
    get lastFailure() {
        return this.innerLastFailure;
    }
    constructor(options, executor) {
        this.options = options;
        this.executor = executor;
        this.breakEmitter = new cockatiel_1.EventEmitter();
        this.resetEmitter = new cockatiel_1.EventEmitter();
        this.halfOpenEmitter = new cockatiel_1.EventEmitter();
        this.stateChangeEmitter = new cockatiel_1.EventEmitter();
        this.innerState = { value: CircuitState.Closed };
        this.onBreak = this.breakEmitter.addListener;
        this.onReset = this.resetEmitter.addListener;
        this.onHalfOpen = this.halfOpenEmitter.addListener;
        this.onStateChange = this.stateChangeEmitter.addListener;
        this.onSuccess = this.executor.onSuccess;
        this.onFailure = this.executor.onFailure;
    }
    isolate() {
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
                if (this.innerState.value === CircuitState.Isolated &&
                    !--this.innerState.counters) {
                    this.innerState = { value: CircuitState.Closed };
                    this.resetEmitter.emit();
                    this.stateChangeEmitter.emit(CircuitState.Closed);
                }
            },
        };
    }
    async execute(fn, signal = exports.neverAbortedSignal) {
        const state = this.innerState;
        switch (state.value) {
            case CircuitState.Closed:
                const result = await this.executor.invoke(fn, { signal });
                const rateLimitStatus = await rateLimitExceeded(this.options.ip, this.options.maxWindowRequestCount, this.options.intervalInMinutes);
                if (rateLimitStatus) {
                    this.stateChangeEmitter.emit(CircuitState.Open);
                    throw new Error(`Rate Limit Exceded`);
                }
                if ("success" in result) {
                    this.options.breaker.success(state.value);
                }
                else {
                    this.innerLastFailure = result;
                    if (this.options.breaker.failure(state.value)) {
                        this.open(result);
                    }
                }
                return (0, exports.returnOrThrow)(result);
            case CircuitState.HalfOpen:
                await state.test.catch(() => undefined);
                if (this.state === CircuitState.Closed && signal.aborted) {
                    throw new cockatiel_1.TaskCancelledError();
                }
                return this.execute(fn);
            case CircuitState.Open:
                if (Date.now() - state.openedAt < this.options.halfOpenAfter) {
                    throw new cockatiel_1.BrokenCircuitError();
                }
                const test = this.halfOpen(fn, signal);
                this.innerState = { value: CircuitState.HalfOpen, test };
                this.stateChangeEmitter.emit(CircuitState.HalfOpen);
                return test;
            case CircuitState.Isolated:
                throw new cockatiel_1.IsolatedCircuitError();
            default:
                throw new Error(`Unexpected circuit state ${state}`);
        }
    }
    async halfOpen(fn, signal) {
        this.halfOpenEmitter.emit();
        try {
            const result = await this.executor.invoke(fn, { signal });
            if ("success" in result) {
                this.options.breaker.success(CircuitState.HalfOpen);
                this.close();
            }
            else {
                this.innerLastFailure = result;
                this.options.breaker.failure(CircuitState.HalfOpen);
                this.open(result);
            }
            return (0, exports.returnOrThrow)(result);
        }
        catch (err) {
            this.close();
            throw err;
        }
    }
    open(reason) {
        if (this.state === CircuitState.Isolated ||
            this.state === CircuitState.Open) {
            return;
        }
        this.innerState = { value: CircuitState.Open, openedAt: Date.now() };
        this.breakEmitter.emit(reason);
        this.stateChangeEmitter.emit(CircuitState.Open);
    }
    close() {
        if (this.state === CircuitState.HalfOpen) {
            this.innerState = { value: CircuitState.Closed };
            this.resetEmitter.emit();
            this.stateChangeEmitter.emit(CircuitState.Closed);
        }
    }
}
exports.RedisRateLimiterPolicy = RedisRateLimiterPolicy;
class ExecuteWrapper {
    constructor(errorFilter = () => false, resultFilter = () => false) {
        this.errorFilter = errorFilter;
        this.resultFilter = resultFilter;
        this.successEmitter = new cockatiel_1.EventEmitter();
        this.failureEmitter = new cockatiel_1.EventEmitter();
        this.onSuccess = this.successEmitter.addListener;
        this.onFailure = this.failureEmitter.addListener;
    }
    clone() {
        return new ExecuteWrapper(this.errorFilter, this.resultFilter);
    }
    async invoke(fn, ...args) {
        const stopwatch = this.successEmitter.size || this.failureEmitter.size
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
        }
        catch (rawError) {
            const error = rawError;
            const handled = this.errorFilter(error);
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
exports.ExecuteWrapper = ExecuteWrapper;
const makeStopwatch = () => {
    if (typeof performance !== "undefined") {
        const start = performance.now();
        return () => performance.now() - start;
    }
    else {
        const start = process.hrtime.bigint();
        return () => Number(process.hrtime.bigint() - start) / 1000000;
    }
};
function redisRateLimiter(policy, opts) {
    return new RedisRateLimiterPolicy(opts, new ExecuteWrapper(policy.options.errorFilter, policy.options.resultFilter));
}
exports.redisRateLimiter = redisRateLimiter;
async function rateLimitExceeded(ip, maxWindowRequestCount = 5, intervalInMinutes = 1) {
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
    let data = JSON.parse(record);
    let windowStartTimestamp = moment().subtract(`${WINDOW_LOG_INTERVAL_IN_MINUTE}`, "minutes").unix();
    let requestsWithinWindow = data.filter((entry) => {
        return entry.requestTimeStamp > windowStartTimestamp;
    });
    let totalWindowRequestsCount = requestsWithinWindow.reduce((accumulator, entry) => {
        return accumulator + entry.requestCount;
    }, 0);
    if (totalWindowRequestsCount >= MAX_WINDOW_REQUEST_COUNT) {
        return true;
    }
    else {
        let lastRequestLog = data[data.length - 1];
        let potentialCurrentWindowIntervalStartTimeStamp = currentRequestTime
            .subtract(`${WINDOW_LOG_INTERVAL_IN_MINUTE}`, "minutes")
            .unix();
        if (lastRequestLog.requestTimeStamp >
            potentialCurrentWindowIntervalStartTimeStamp) {
            lastRequestLog.requestCount++;
            data[data.length - 1] = lastRequestLog;
        }
        else {
            data.push({
                requestTimeStamp: currentRequestTime.unix(),
                requestCount: 1,
            });
        }
        await redis.set(ip, JSON.stringify(data));
        return false;
    }
}
//# sourceMappingURL=RedisRateLimiterPolicy.js.map