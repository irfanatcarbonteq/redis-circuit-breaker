import { IBreaker,CircuitState } from "cockatiel";
import Redis from "ioredis";
const redis = new Redis();

interface IRedisBreaker {
    /**
     * Called when a call succeeds.
     */
    success(state: CircuitState): void;
    /**
     * Called when a call fails. Returns true if the circuit should open.
     */
    failure(state: CircuitState): Promise<boolean>;
}

export class RedisConsecutiveBreaker implements IRedisBreaker {
  private count = 0;

  constructor(private readonly threshold: number) {}

  public success() {
    this.count = 0;
  }

  public async failure() {
    let count = await redis.get("count");
    if (count) {
      let incrementedCount = parseInt(count);
      incrementedCount++;
      redis.set("count", `${incrementedCount}`);
    } else {
      redis.set("count", `0`);
    }
    let newCount = await redis.get("count");
    const parsedCount = parseInt(newCount);
    return parsedCount >= this.threshold;
  }
}
