<div align="center">
<h3 align="center">Redis Sampling Breaker</h3>

  <p align="center">
    Redis Sampling Breaker is built on [Cockatiel](https://github.com/connor4312/cockatiel) with redis.
  </p>
</div>

<details>
  <summary>Table of Contents</summary>
  <ol>
    <li>
      <a href="#about-the-project">About The Project</a>
      <ul>
        <li><a href="#built-with">Built With</a></li>
      </ul>
    </li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#installation">Installation</a></li>
      </ul>
    </li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#contributing">Contributing</a></li>
  </ol>
</details>

## About The Project

An enhancement to a circuit breaker with a rate limiter to protect your application from overloading due to excessive requests. The breaker can be used to stop sending requests to a service that is failing or is overloaded together with the rate limiter that limits the number of requests that can be made within a certain time period. Together, circuit breaker and rate limiter can help prevent your application from crashing or becoming unresponsive due to too many requests.

<p align="right">(<a href="#top">back to top</a>)</p>

### Built With

This project is built on the top of cockatiel.

* [Cockatiel](https://github.com/connor4312/cockatiel)

<p align="right">(<a href="#top">back to top</a>)</p>

<!-- GETTING STARTED -->

## Getting Started

You should have a basic setup of nodejs project using typescript

### Prerequisites

Should have a sound knowledge of Circuit Breaker, Rate Limiter and typescript.

### Installation

1. Install redis sampling breaker package
   ```sh
   npm i redis-sampling-breaker
   ```
<p align="right">(<a href="#top">back to top</a>)</p>

## Usage

Then go forth with sampling breaker:

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
  const data = await retryWithBreaker.execute(() =>database.getInfo(req.params.id));
  return res.json(data);
};
```


With rate limiting policy:

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
import { RedisSamplingBreaker,redisRateLimiter } from "redis-sampling-breaker";

exports.handleRequest = async (req, res) => {
  const redisRateLimiterPolicy = redisRateLimiter(handleAll, {
      halfOpenAfter: 10 * 1000,
      breaker: new RedisSamplingBreaker({ threshold: 0.2, duration: 30 * 1000 }) ,
      ip: req.ip,
      maxWindowRequestCount: 5,
      intervalInMinutes: 1
    });   
  const data = await redisRateLimiterPolicy.execute(() =>database.getInfo(req.params.id));
  return res.json(data);
};
```


<p align="right">(<a href="#top">back to top</a>)</p>

## Contributing

Contributions are what make the open source community such an amazing place to learn, inspire, and create. Any
contributions you make are **greatly appreciated**.

If you have a suggestion that would make this better, please fork the repo and create a pull request. You can also
simply open an issue with the tag "enhancement". Don't forget to give the project a star! Thanks again!

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

<p align="right">(<a href="#top">back to top</a>)</p>