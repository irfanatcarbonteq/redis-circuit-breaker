"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const cockatiel_1 = require("cockatiel");
(0, chai_1.use)(require("chai-as-promised"));
const RateLimiterPolicy_1 = require("./RateLimiterPolicy");
describe("Sliding WIndow Counter", () => {
    it("It should work", async () => {
        const rateLimiterPolicy = (0, RateLimiterPolicy_1.rateLimiter)(cockatiel_1.handleAll, {
            driver: new RateLimiterPolicy_1.SlidingWindowCounterDriver({
                hash: "abc",
                maxWindowRequestCount: 5,
                intervalInSeconds: 1 * 60,
            }),
        });
        (0, chai_1.expect)(await rateLimiterPolicy.execute(() => 42)).to.equal(42);
    });
    it("It should throw an Error", async () => {
        const rateLimiterPolicy = (0, RateLimiterPolicy_1.rateLimiter)(cockatiel_1.handleAll, {
            driver: new RateLimiterPolicy_1.SlidingWindowCounterDriver({
                hash: "abc",
                maxWindowRequestCount: 5,
                intervalInSeconds: 1 * 60,
            }),
        });
        (0, chai_1.expect)(await rateLimiterPolicy.execute(() => 42)).to.equal(42);
        (0, chai_1.expect)(await rateLimiterPolicy.execute(() => 42)).to.equal(42);
        (0, chai_1.expect)(await rateLimiterPolicy.execute(() => 42)).to.equal(42);
        (0, chai_1.expect)(await rateLimiterPolicy.execute(() => 42)).to.equal(42);
        (0, chai_1.expect)(await rateLimiterPolicy.execute(() => 42)).to.equal(42);
        (0, chai_1.expect)(await rateLimiterPolicy.execute(() => 42)).to.throw("Rate Limit Exceded");
    });
});
describe("Leaky Bucket", () => {
    it("It should work", async () => {
        const rateLimiterPolicy = (0, RateLimiterPolicy_1.rateLimiter)(cockatiel_1.handleAll, {
            driver: new RateLimiterPolicy_1.LeakyBucketDriver({
                hash: 'xyz',
                bucketSize: 5,
                fillRate: 10,
            }),
        });
        (0, chai_1.expect)(await rateLimiterPolicy.execute(() => 42)).to.equal(42);
    });
    it("It should throw an Error", async () => {
        const rateLimiterPolicy = (0, RateLimiterPolicy_1.rateLimiter)(cockatiel_1.handleAll, {
            driver: new RateLimiterPolicy_1.LeakyBucketDriver({
                hash: 'xyz',
                bucketSize: 5,
                fillRate: 10,
            }),
        });
        (0, chai_1.expect)(await rateLimiterPolicy.execute(() => 42)).to.equal(42);
        (0, chai_1.expect)(await rateLimiterPolicy.execute(() => 42)).to.equal(42);
        (0, chai_1.expect)(await rateLimiterPolicy.execute(() => 42)).to.equal(42);
        (0, chai_1.expect)(await rateLimiterPolicy.execute(() => 42)).to.equal(42);
        (0, chai_1.expect)(await rateLimiterPolicy.execute(() => 42)).to.equal(42);
        (0, chai_1.expect)(await rateLimiterPolicy.execute(() => 42)).to.throw("Rate Limit Exceded");
    });
});
//# sourceMappingURL=RateLimiter.test.js.map