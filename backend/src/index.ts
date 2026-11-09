/**
 * Worker entry point: one Worker, three entry points (HTTP, queue, cron). See ARCHITECTURE.md §1.
 */
import type { Env } from './config';
import { buildDeps } from './deps';
import { createApp } from './http/app';
import { processBatch, processDeadLetterBatch, type QueueMessageLike } from './queue/consumer';
import { runSweep } from './services/background';

const app = createApp({
  makeDeps: (c) => buildDeps(c.env),
  afterRequest: (c, deps) => {
    try {
      c.executionCtx.waitUntil(deps.db.$disconnect());
    } catch {
      /* no execution context (e.g. app.request in tests) */
    }
  },
  rateLimit: async (c, key) => {
    const limiter = c.env.PUBLIC_RATE_LIMITER;
    if (!limiter) return true;
    return (await limiter.limit({ key })).success;
  },
});

export default {
  fetch: app.fetch,

  async queue(batch: { queue: string; messages: readonly QueueMessageLike[] }, env: Env, ctx: ExecutionContext): Promise<void> {
    const deps = buildDeps(env, { queue: batch.queue });
    try {
      if (batch.queue.endsWith('-dlq')) await processDeadLetterBatch(deps, batch.messages);
      else await processBatch(deps, batch.messages);
    } finally {
      ctx.waitUntil(deps.db.$disconnect());
    }
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const deps = buildDeps(env, { trigger: 'cron' });
    try {
      await runSweep(deps);
    } catch (err) {
      deps.log.error('cron.sweep_failed', { error: (err as Error).message });
      throw err;
    } finally {
      ctx.waitUntil(deps.db.$disconnect());
    }
  },
};
