import { Router } from 'express';
import * as Redis from 'ioredis';
import { Runtype as Rt, Static } from 'runtypes';

import {
  ActorAddress,
  addMessageToMailbox,
  checkAddressExists,
  getNextMessage,
  getState,
  isLockAcquired,
  MailboxMessage,
  ProcessContext,
  releaseLock,
  setState,
} from './lib';

type CallHandler<Match extends Rt, Result, State> = (
  msg: Static<Match>,
  prevState: State
) => Promise<[Result, State]>;

type CallExecutor<Match extends Rt, Result> = (
  pc: ProcessContext,
  pid: ActorAddress,
  msg: Static<Match>
) => Promise<Result>;

type CastHandler<Match extends Rt, State> = (
  msg: Static<Match>,
  prevState: State
) => Promise<State>;

type CastExecutor<Match extends Rt, State> = (
  pc: ProcessContext,
  pid: ActorAddress,
  msg: Static<Match>
) => Promise<State>;

type DefineRoleParams<State, InitParams> = {
  init: (params: InitParams) => Promise<State>;
  onTerminate?: (reason: string, params: State) => Promise<any>;
  role: string;
};

export type Role<State> = {
  addCastHandler: <Match extends Rt>(
    m: Match,
    handler: CastHandler<Match, State>
  ) => CastExecutor<Match, State>;
  addCallHandler: <Match extends Rt, Result>(
    m: Match,
    handler: CallHandler<Match, Result, State>
  ) => CallExecutor<Match, Result>;
  attach: (pc: ProcessContext) => void;
};

export const defineRole = <State, InitParams>(
  params: DefineRoleParams<State, InitParams>
): Role<State> => {
  const callHandlers: [Rt, CallHandler<any, any, State>][] = [];
  const castHandlers: [Rt, CastHandler<any, State>][] = [];

  const handleMailboxUntilComplete = async (
    redis: Redis.Redis,
    address: string
  ) => {
    let msg: MailboxMessage, state;
    while ((msg = await getNextMessage(redis, address))) {
      if (state === undefined) {
        state = await getState(redis, address);
      }

      if (msg.type === 'CALL') {
        const [_rt, callHandler] = callHandlers.find(([matcher, _runner]) =>
          matcher.guard(msg.payload)
        );

        if (!callHandler) {
          throw new Error(`No call handler matches: ${JSON.stringify(msg)}`);
        }

        const [result, newState] = await callHandler(msg, state);
        await setState(redis, address, newState);
        redis.publish(msg.caller, JSON.stringify(result));
        state = newState;
      } else if (msg.type === 'CAST') {
        const [_rt, castHandler] = castHandlers.find(([matcher, _runner]) =>
          matcher.guard(msg.payload)
        );

        if (!castHandler) {
          throw new Error(`No cast handler matches: ${JSON.stringify(msg)}`);
        }

        const newState = await castHandler(msg, state);
        await setState(redis, address, newState);
        state = newState;
      }
    }
  };

  const addCallHandler = <Match extends Rt, Result>(
    m: Match,
    handler: CallHandler<Match, Result, State>
  ): CallExecutor<Match, Result> => {
    // Add handler
    callHandlers.push([m, handler]);

    // Subscribe to /caller_pid/msg_id
    // Create a promise that resolves with subscription
    // Make http request to pid route with caller pid, msg, and msg_id
    // If http request response is not 400, return with specific error
    // Otherwise, return promise that resolves with pubsub result

    return async (
      pc: ProcessContext,
      address: ActorAddress,
      msg: Static<Match>
    ) => {
      return new Promise((resolve, reject) => {
        pc.redis.subscribe('');
      });
      redis;
      const [result, state] = await handler(msg, null as State);
      return result;
    };
  };

  const addCastHandler = <Match extends Rt>(
    m: Match,
    handler: CastHandler<Match, State>
  ): CastExecutor<Match, State> => {
    castHandlers.push([m, handler]);

    // Make http request to pid route with caller pid, msg, and msg_id
    // If http request response is not 400, return with specific error

    return async (name: string, msg: Static<Match>) => {
      const result = await handler(msg, null as State);
      return result;
    };
  };

  const router = Router();

  // Execute init
  router.post(
    `/${params.role}/:address/:type`,
    checkAddressExists(redis),
    async (req, res) => {
      const address = req.params.address;
      const type = req.params.type as 'call' | 'cast' | 'init';

      // Check that msg conforms to expected call type
      if (type === 'call' || type === 'cast') {
        const handlers = {
          call: callHandlers,
          cast: castHandlers,
        }[type] as [Rt, any][];

        const match = handlers.find(([rt, _]) => {
          return rt.guard(req.body);
        });

        if (!match) {
          return res.status(403).json({
            error: `No match found for type ${type}, payload ${JSON.stringify(
              req.body
            )}`,
          });
        }
      }

      const message: MailboxMessage = {
        caller: req.headers.caller as string,
        type: 'CALL',
        payload: req.body,
      };

      if (type === 'init') {
        const lockAcquired = await isLockAcquired(redis, address);

        if (!isLockAcquired) {
          return res
            .status(500)
            .json({ error: `Process already exists at address ${address}` });
        }

        const state = await params.init(req.body);
        await setState(redis, address, state);
      } else {
        await addMessageToMailbox(redis, address, message);
        res.sendStatus(200);

        const lockAcquired = await isLockAcquired(redis, address);

        // If someone else has the lock, we just exit - they'll handle it
        if (!lockAcquired) {
          return;
        }
      }

      // At this point, we have the lock and should
      // process whatever messages have accumulated
      // and exit, releasing the lock
      await handleMailboxUntilComplete(redis, address);
      await releaseLock(redis, address);
    }
  );

  return { addCallHandler, addCastHandler, attach };
};
