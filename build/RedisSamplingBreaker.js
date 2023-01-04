"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedisSamplingBreaker = void 0;
const cockatiel_1 = require("cockatiel");
const ioredis_1 = require("ioredis");
const redis = new ioredis_1.default();
class RedisSamplingBreaker {
    constructor({ threshold, duration: samplingDuration, minimumRps, }) {
        this.windows = [];
        this.currentWindow = 0;
        this.currentFailures = 0;
        this.currentSuccesses = 0;
        if (threshold <= 0 || threshold >= 1) {
            throw new RangeError(`SamplingBreaker threshold should be between (0, 1), got ${threshold}`);
        }
        this.threshold = threshold;
        const windowCount = Math.max(5, Math.ceil(samplingDuration / 1000));
        for (let i = 0; i < windowCount; i++) {
            this.windows.push({ startedAt: 0, failures: 0, successes: 0 });
        }
        this.windowSize = Math.round(samplingDuration / windowCount);
        this.duration = this.windowSize * windowCount;
        if (minimumRps) {
            this.minimumRpms = minimumRps / 1000;
        }
        else {
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
    success(state) {
        if (state === cockatiel_1.CircuitState.HalfOpen) {
            this.resetWindows();
        }
        this.push(true);
    }
    async failure(state) {
        this.push(false);
        if (state !== cockatiel_1.CircuitState.Closed) {
            return true;
        }
        const redisCurrentSuccess = await redis.get("currentSuccesses");
        const currentSuccesses = Number(redisCurrentSuccess);
        const redisCurrentFailures = await redis.get("currentFailures");
        const currentFailures = Number(redisCurrentFailures);
        const total = currentSuccesses + currentFailures;
        const redisDuration = await redis.get("duration");
        const duration = Number(redisDuration);
        const redisMinimumRpms = await redis.get("minimumRpms");
        const minimumRpms = Number(redisMinimumRpms);
        if (total < duration * minimumRpms) {
            return false;
        }
        if (currentFailures > this.threshold * total) {
            return true;
        }
        return false;
    }
    async resetWindows() {
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
    async rotateWindow(now) {
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
    async push(success) {
        const now = Date.now();
        const redisWindows = await redis.get("windows");
        const redisCurrentWindow = await redis.get("currentWindow");
        const currentWindow = Number(redisCurrentWindow);
        const windows = JSON.parse(redisWindows);
        let window = windows[currentWindow];
        if (now - window.startedAt >= this.windowSize) {
            window = this.rotateWindow(now);
        }
        const redisNextWindow = await redis.get("currentWindow");
        const nextWindow = Number(redisNextWindow);
        if (success) {
            const window = windows[nextWindow];
            const redisCurrentSuccess = await redis.get("currentSuccesses");
            const currentSuccesses = Number(redisCurrentSuccess);
            window.successes++;
            redis.set("currentSuccesses", currentSuccesses + 1);
        }
        else {
            const window = windows[nextWindow];
            const redisCurrentFailures = await redis.get("currentFailures");
            const currentFailures = Number(redisCurrentFailures);
            redis.set("currentSuccesses", currentFailures + 1);
            window.failures++;
        }
        redis.set("windows", JSON.stringify(windows));
    }
}
exports.RedisSamplingBreaker = RedisSamplingBreaker;
//# sourceMappingURL=RedisSamplingBreaker.js.map