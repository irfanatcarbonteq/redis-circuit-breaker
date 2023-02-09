"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LeakyBucketDriver = exports.SlidingWindowCounterDriver = exports.ExecuteWrapper = exports.rateLimiter = exports.RateLimiterPolicy = exports.neverAbortedSignal = exports.returnOrThrow = void 0;
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
class RateLimiterPolicy {
    constructor(driverOptions, executor) {
        this.driverOptions = driverOptions;
        this.executor = executor;
        this.onSuccess = this.executor.onSuccess;
        this.onFailure = this.executor.onFailure;
    }
    async execute(fn, signal = exports.neverAbortedSignal) {
        let rateLimitStatus = false;
        if (this.driverOptions.driver instanceof SlidingWindowCounterDriver) {
            rateLimitStatus = await rateLimitExceeded(this.driverOptions.driver);
        }
        else {
            rateLimitStatus = await leakyBuckedExceeded(this.driverOptions.driver);
        }
        if (rateLimitStatus) {
            throw new Error(`Rate Limit Exceded`);
        }
        const result = await this.executor.invoke(fn, { signal });
        return (0, exports.returnOrThrow)(result);
    }
}
exports.RateLimiterPolicy = RateLimiterPolicy;
function rateLimiter(policy, driverOptions) {
    return new RateLimiterPolicy(driverOptions, new ExecuteWrapper(policy.options.errorFilter, policy.options.resultFilter));
}
exports.rateLimiter = rateLimiter;
async function rateLimitExceeded(driver) {
    const MAX_WINDOW_REQUEST_COUNT = driver.maxWindowRequestCount;
    const WINDOW_LOG_INTERVAL_IN_SECONDS = driver.intervalInSeconds;
    const record = await redis.get(driver.hash);
    const currentRequestTime = moment();
    if (!record) {
        let newRecord = [];
        let requestLog = {
            requestTimeStamp: currentRequestTime.unix(),
            requestCount: 1,
        };
        newRecord.push(requestLog);
        await redis.set(driver.hash, JSON.stringify(newRecord), "EX", Number(WINDOW_LOG_INTERVAL_IN_SECONDS));
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
        const expirationTime = await redis.ttl(driver.hash);
        await redis.set(driver.hash, JSON.stringify(data), "EX", expirationTime);
        return false;
    }
}
async function leakyBuckedExceeded(driver) {
    const BUCKET_SIZE = driver.bucketSize;
    const Fill_RATE = driver.fillRate;
    const bucket_count = await redis.get(driver.hash);
    if (!bucket_count) {
        await redis.set(driver.hash, 0);
        return false;
    }
    let bucket_count_number = parseInt(bucket_count);
    bucket_count_number++;
    await redis.set(driver.hash, bucket_count_number);
    if (bucket_count_number > BUCKET_SIZE) {
        return true;
    }
    setTimeout(async () => {
        const bucket_count = await redis.get(driver.hash);
        let bucket_count_number = parseInt(bucket_count);
        bucket_count_number--;
        await redis.set(driver.hash, bucket_count_number);
    }, 1000 / Fill_RATE);
    return false;
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
class SlidingWindowCounterDriver {
    constructor(driverOptions) {
        this.hash = driverOptions.hash;
        this.maxWindowRequestCount = driverOptions.maxWindowRequestCount;
        this.intervalInSeconds = driverOptions.intervalInSeconds;
    }
}
exports.SlidingWindowCounterDriver = SlidingWindowCounterDriver;
class LeakyBucketDriver {
    constructor(driverOptions) {
        this.hash = driverOptions.hash;
        this.bucketSize = driverOptions.bucketSize;
        this.fillRate = driverOptions.fillRate;
    }
}
exports.LeakyBucketDriver = LeakyBucketDriver;
//# sourceMappingURL=RateLimiterPolicy.js.map