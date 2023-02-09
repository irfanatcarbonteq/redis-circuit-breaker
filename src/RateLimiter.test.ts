import { expect, use } from "chai";
import { handleAll } from "cockatiel";
use(require("chai-as-promised"));
import { rateLimiter, SlidingWindowCounterDriver,LeakyBucketDriver } from "./RateLimiterPolicy";

describe("Sliding WIndow Counter", () => {
  it("It should work", async () => {
    const rateLimiterPolicy = rateLimiter(handleAll, {
      driver: new SlidingWindowCounterDriver({
        hash: "abc",
        maxWindowRequestCount: 5,
        intervalInSeconds: 1 * 60,
      }),
    });
    expect(await rateLimiterPolicy.execute(() => 42)).to.equal(42);
  });

  it("It should throw an Error", async () => {
    const rateLimiterPolicy = rateLimiter(handleAll, {
      driver: new SlidingWindowCounterDriver({
        hash: "abc",
        maxWindowRequestCount: 5,
        intervalInSeconds: 1 * 60,
      }),
    });

    expect(await rateLimiterPolicy.execute(() => 42)).to.equal(42);
    expect(await rateLimiterPolicy.execute(() => 42)).to.equal(42);
    expect(await rateLimiterPolicy.execute(() => 42)).to.equal(42);
    expect(await rateLimiterPolicy.execute(() => 42)).to.equal(42);
    expect(await rateLimiterPolicy.execute(() => 42)).to.equal(42);

    expect(await rateLimiterPolicy.execute(() => 42)).to.throw(
      "Rate Limit Exceded"
    );
  });
});


describe("Leaky Bucket", () => {
  it("It should work", async () => {
    const rateLimiterPolicy = rateLimiter(handleAll, {
      driver: new LeakyBucketDriver({
        hash: 'xyz',
        bucketSize: 5,
        fillRate: 10,
      }),
    });
    expect(await rateLimiterPolicy.execute(() => 42)).to.equal(42);
  });

  it("It should throw an Error", async () => {
    const rateLimiterPolicy = rateLimiter(handleAll, {
      driver: new LeakyBucketDriver({
        hash: 'xyz',
        bucketSize: 5,
        fillRate: 10,
      }),
    });

    expect(await rateLimiterPolicy.execute(() => 42)).to.equal(42);
    expect(await rateLimiterPolicy.execute(() => 42)).to.equal(42);
    expect(await rateLimiterPolicy.execute(() => 42)).to.equal(42);
    expect(await rateLimiterPolicy.execute(() => 42)).to.equal(42);
    expect(await rateLimiterPolicy.execute(() => 42)).to.equal(42);

    expect(await rateLimiterPolicy.execute(() => 42)).to.throw(
      "Rate Limit Exceded"
    );
  });
});
