"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SlidingWindowCounter = void 0;
const ioredis_1 = require("ioredis");
const moment = require("moment");
const redis = new ioredis_1.default();
class SlidingWindowCounter {
    constructor(ip) {
        this.ip = ip;
    }
    async run(fn) {
        const WINDOW_SIZE = 24;
        const MAX_WINDOW_REQUEST_COUNT = 5;
        const WINDOW_LOG_INTERVAL_IN_MINUTE = 1;
        const record = await redis.get(this.ip);
        const currentRequestTime = moment();
        if (!record) {
            let newRecord = [];
            let requestLog = {
                requestTimeStamp: currentRequestTime.unix(),
                requestCount: 1,
            };
            newRecord.push(requestLog);
            await redis.set(this.ip, JSON.stringify(newRecord));
        }
        let data = JSON.parse(record);
        let windowStartTimestamp = moment().subtract(WINDOW_SIZE, "minutes").unix();
        let requestsWithinWindow = data.filter((entry) => {
            return entry.requestTimeStamp > windowStartTimestamp;
        });
        let totalWindowRequestsCount = requestsWithinWindow.reduce((accumulator, entry) => {
            return accumulator + entry.requestCount;
        }, 0);
        if (totalWindowRequestsCount >= MAX_WINDOW_REQUEST_COUNT) {
            throw new Error(`You have exceeded the 5 requests in 1 minute limit!`);
        }
        else {
            let lastRequestLog = data[data.length - 1];
            let potentialCurrentWindowIntervalStartTimeStamp = currentRequestTime
                .subtract(WINDOW_LOG_INTERVAL_IN_MINUTE, "minutes")
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
            await redis.set(this.ip, JSON.stringify(data));
        }
        const result = await fn();
        return result;
    }
}
exports.SlidingWindowCounter = SlidingWindowCounter;
//# sourceMappingURL=SlidingWindowCounter.js.map