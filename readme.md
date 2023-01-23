# redis-sampling-breaker

Redis Sampling Breaker is resilience and transient-fault-handling library that allows developers to express policies such as Retry, Circuit Breaker. Redis Sampling Breaker is built on [Cockatiel](https://github.com/connor4312/cockatiel) with redis.

    npm install --save redis-sampling-breaker

Then go forth with confidence:

```js
import {
  ConsecutiveBreaker,
  ExponentialBackoff,
  retry,
  handleAll,
  circuitBreaker,
  wrap,
} from 'cockatiel';
import { database } from './my-db';
import { RedisConsecutiveBreaker } from "redis-sampling-breaker";
import { RedisSamplingBreaker } from "redis-sampling-breaker";
// Create a retry policy that'll try whatever function we execute 3
// times with a randomized exponential backoff.
const retry = retry(handleAll, { maxAttempts: 3, backoff: new ExponentialBackoff() });

// Create a circuit breaker that'll stop calling the executed function for 10
// seconds if it fails 5 times in a row. This can give time for e.g. a database
// to recover without getting tons of traffic.
const circuitBreaker = circuitBreaker(handleAll, {
  halfOpenAfter: 10 * 1000,
  breaker: new RedisSamplingBreaker({ threshold: 0.2, duration: 30 * 1000 }),
});

// Combine these! Create a policy that retries 3 times, calling through the circuit breaker
const retryWithBreaker = wrap(retry, circuitBreaker);

exports.handleRequest = async (req, res) => {
  // Call your database safely!
  const data = await retryWithBreaker.execute(() => database.getInfo(req.params.id));
  return res.json(data);
};
```

```js
import {
  ConsecutiveBreaker,
  ExponentialBackoff,
  retry,
  handleAll,
  circuitBreaker,
  wrap,
} from 'cockatiel';
import { database } from './my-db';
import { SlidingWindowCounter } from "redis-sampling-breaker";
// Create a retry policy that'll try whatever function we execute 3
// times with a randomized exponential backoff.
const retry = retry(handleAll, { maxAttempts: 3, backoff: new ExponentialBackoff() });

// Create a circuit breaker that'll stop calling the executed function for 10
// seconds if it fails 5 times in a row. This can give time for e.g. a database
// to recover without getting tons of traffic.
const circuitBreaker = circuitBreaker(handleAll, {
  halfOpenAfter: 10 * 1000,
  breaker: new RedisSamplingBreaker({ threshold: 0.2, duration: 30 * 1000 }),
});

// Combine these! Create a policy that retries 3 times, calling through the circuit breaker
const retryWithBreaker = wrap(retry, circuitBreaker);

exports.handleRequest = async (req, res) => {
  // Call your database safely with sliding window counter!
  const slidingWindowCounter = new SlidingWindowCounter(req.ip); 
  const data = await retryWithBreaker.execute(() => slidingWindowCounter.run(database.getInfo(req.params.id)));
  return res.json(data);
};
```