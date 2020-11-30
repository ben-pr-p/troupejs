import { SuperAgent } from 'superagent'
import * as Redis from 'ioredis';

export type ActorAddress = string;
export type ActorPid = string;

export const generatePid = (): ActorPid => Math.random().toString().slice(2);

export const isLockAcquired = async (
  redis: Redis.Redis,
  address: ActorAddress
): Promise<boolean> => {
  const myPid = generatePid();

  const lockKey = `lock-${address}`;
  await redis.setnx(lockKey, myPid);
  const pidWithLock = await redis.get(lockKey);

  return pidWithLock === myPid;
};

export const releaseLock = async (
  redis: Redis.Redis,
  address: ActorAddress
) => {
  const lockKey = `lock-${address}`;
  await redis.del(lockKey);
};

export type MailboxMessage = {
  caller: string;
  type: 'CALL' | 'CAST';
  payload: any;
};

export const addMessageToMailbox = async (
  redis: Redis.Redis,
  address: ActorAddress,
  msg: MailboxMessage
): Promise<void> => {
  const mailboxKey = `mailbox-${address}`;
  await redis.lpush(mailboxKey, JSON.stringify(msg));
};

export const getNextMessage = async (
  redis: Redis.Redis,
  address: ActorAddress
): Promise<MailboxMessage> => {
  const mailboxKey = `mailbox-${address}`;
  const msg = await redis.rpop(mailboxKey);
  return JSON.parse(msg);
};

export const getState = async (redis: Redis.Redis, address: ActorAddress) => {
  const stateKey = `state-${address}`;
  const state = await redis.get(stateKey);
  return state ? JSON.parse(state) : null;
};

export const setState = async (
  redis: Redis.Redis,
  address: ActorAddress,
  state: any
) => {
  const stateKey = `state-${address}`;
  await redis.set(stateKey, JSON.stringify(state));
};

export const checkAddressExists = (redis: Redis.Redis) => async (
  req,
  res,
  next
) => {
  const metadataKey = `meta-${req.params.address}`;
  const context = await redis.hgetall(metadataKey);

  if (!context.parent) {
    return res.status(404).send({ error: 'Process does not exist' });
  }

  req.processExist = context;

  return next();
};

export type ProcessContext = {
  app: Express.Application;
  httpAgent: SuperAgent<any>;
  redis: Redis.Redis;
}
};
