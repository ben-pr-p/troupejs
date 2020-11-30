import test from 'ava';
import express from 'express';
import * as Redis from 'ioredis';
import RedisMock from 'ioredis-mock';
import { Literal, Number } from 'runtypes';
import supertest from 'supertest';

import { createTroupe, defineRole } from './index';

const Counter = defineRole<number, number>({
  role: 'counter',
  init: async (startingValue: number) => startingValue,
});

const addN = Counter.addCastHandler(
  Number,
  async (n, prevState) => prevState + n
);

const getN = Counter.addCallHandler(Literal('get'), async (_, prevState) => [
  prevState,
  prevState,
]);

test('counter works as expected', async (t) => {
  const app = express();
  const redis = new RedisMock() as Redis.Redis;

  const troupe = createTroupe({
    app,
    redis,
    httpAgent: supertest(app),
    roles: [Counter],
  });

  const pid = await troupe.spawn(Counter, 3);
  addN(troupe.context, pid, 5);
  const n = await getN(troupe.context, pid, 'get');
  t.deepEqual(n, 8);
});
