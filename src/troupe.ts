import { default as Redis } from 'ioredis';
import { SuperAgent } from 'superagent';

import { ActorAddress, generatePid, ProcessContext } from './lib';
import { Role } from './role';

type CreateTroupeParams = {
  app: Express.Application;
  httpAgent: SuperAgent<any>;
  redis: Redis.Redis;
  roles: Role<any>[];
};

export const createTroupe = (params: CreateTroupeParams) => {
  const { app, httpAgent, redis, roles } = params;

  const pc = {
    app,
    httpAgent,
    redis,
  };

  for (const role of roles) {
    role.attach(pc);
  }

  const context = {
    pid: generatePid(),
    ...pc,
  };

  const spawn = async (role: Role<any>, args: any, name?: ActorAddress) => {
    const pid = name || generatePid();
    // record that this is something i supervise - sadd
    // record that i am this things supervisor
  };

  const kill = async (pid: ActorAddress) => {};
  const killAll = async (pid: ActorAddress) => {};

  return {
    spawn,
    context,
    kill,
    killAll,
  };
};
