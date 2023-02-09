"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConsecutiveBreaker = void 0;
const ioredis_1 = require("ioredis");
const redis = new ioredis_1.default();
class ConsecutiveBreaker {
    constructor(threshold) {
        this.threshold = threshold;
    }
    success() {
        redis.set("count", `0`);
    }
    async failure() {
        let count = await redis.get("count");
        if (count) {
            let incrementedCount = parseInt(count);
            incrementedCount++;
            redis.set("count", `${incrementedCount}`);
        }
        else {
            redis.set("count", `0`);
        }
        let newCount = await redis.get("count");
        const parsedCount = parseInt(newCount);
        return parsedCount >= this.threshold;
    }
}
exports.ConsecutiveBreaker = ConsecutiveBreaker;
//# sourceMappingURL=ConsectiveBreaker.js.map