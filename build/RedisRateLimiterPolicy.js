"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExecuteWrapper = exports.redisRateLimiter = exports.RedisRateLimiterPolicy = exports.neverAbortedSignal = exports.returnOrThrow = void 0;
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
class RedisRateLimiterPolicy {
    constructor(options, executor) {
        this.options = options;
        this.executor = executor;
        this.onSuccess = this.executor.onSuccess;
        this.onFailure = this.executor.onFailure;
    }
    async execute(fn, signal = exports.neverAbortedSignal) {
        const rateLimitStatus = await rateLimitExceeded(this.options.hash, this.options.maxWindowRequestCount, this.options.windowLengthInSeconds);
        if (rateLimitStatus) {
            throw new Error(`Rate Limit Exceded`);
        }
        const result = await this.executor.invoke(fn, { signal });
        return (0, exports.returnOrThrow)(result);
    }
}
exports.RedisRateLimiterPolicy = RedisRateLimiterPolicy;
function redisRateLimiter(policy, opts) {
    return new RedisRateLimiterPolicy(opts, new ExecuteWrapper(policy.options.errorFilter, policy.options.resultFilter));
}
exports.redisRateLimiter = redisRateLimiter;
async function rateLimitExceeded(hash, maxWindowRequestCount = 5, windowLengthInSeconds = 1 * 60) {
    const MAX_WINDOW_REQUEST_COUNT = maxWindowRequestCount;
    const WINDOW_LOG_INTERVAL_IN_SECONDS = windowLengthInSeconds;
    const record = await redis.get(hash);
    const currentRequestTime = moment();
    if (!record) {
        let newRecord = [];
        let requestLog = {
            requestTimeStamp: currentRequestTime.unix(),
            requestCount: 1,
        };
        newRecord.push(requestLog);
        await redis.set(hash, JSON.stringify(newRecord), "EX", Number(WINDOW_LOG_INTERVAL_IN_SECONDS));
        return false;
    }
    let data = JSON.parse(record);
    let windowStartTimestamp = moment()
        .subtract(`${WINDOW_LOG_INTERVAL_IN_SECONDS}`, "seconds")
        .unix();
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
            .subtract(`${WINDOW_LOG_INTERVAL_IN_SECONDS}`, "seconds")
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
        const expirationTime = await redis.ttl(hash);
        await redis.set(hash, JSON.stringify(data), "EX", expirationTime);
        return false;
    }
}
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
        try {
            const value = await fn(...args);
            if (!this.resultFilter(value)) {
                return { success: value };
            }
            return { value };
        }
        catch (rawError) {
            const error = rawError;
            const handled = this.errorFilter(error);
            if (!handled) {
                throw error;
            }
            return { error };
        }
    }
}
exports.ExecuteWrapper = ExecuteWrapper;
//# sourceMappingURL=RedisRateLimiterPolicy.js.map