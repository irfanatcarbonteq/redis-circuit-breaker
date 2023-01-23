import Redis from "ioredis";
import * as moment from "moment";
const redis = new Redis();
export class SlidingWindowCounter {
  private ip: string;
  constructor(ip: string) {
    this.ip = ip;
  }

  async run(fn: Function): Promise<any> {
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
    // if record is found, parse it's value and calculate number of requests users has made within the last window
    let data = JSON.parse(record);
    let windowStartTimestamp = moment().subtract(WINDOW_SIZE, "minutes").unix();
    let requestsWithinWindow = data.filter((entry) => {
      return entry.requestTimeStamp > windowStartTimestamp;
    });
    
    let totalWindowRequestsCount = requestsWithinWindow.reduce(
      (accumulator, entry) => {
        return accumulator + entry.requestCount;
      },
      0
    );
    
    // if number of requests made is greater than or equal to the desired maximum, return error
    if (totalWindowRequestsCount >= MAX_WINDOW_REQUEST_COUNT) {
      throw new Error(`You have exceeded the 5 requests in 1 minute limit!`);
    } else {
      // if number of requests made is less than allowed maximum, log new entry
      let lastRequestLog = data[data.length - 1];
      let potentialCurrentWindowIntervalStartTimeStamp = currentRequestTime
        .subtract(WINDOW_LOG_INTERVAL_IN_MINUTE, "minutes")
        .unix();
      //  if interval has not passed since last request log, increment counter
      if (
        lastRequestLog.requestTimeStamp >
        potentialCurrentWindowIntervalStartTimeStamp
      ) {
        lastRequestLog.requestCount++;
        data[data.length - 1] = lastRequestLog;
      } else {
        //  if interval has passed, log new entry for current user and timestamp
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