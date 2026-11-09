import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '../generated/prisma/client';

export type Db = PrismaClient;
export type Tx = Prisma.TransactionClient;
export { Prisma };

/**
 * Create a Prisma client for ONE invocation (request, queue batch or cron tick).
 * On Workers, never cache it at module scope: connections can't be shared across requests.
 * The connection string comes from Hyperdrive (caching disabled; see wrangler.jsonc).
 */
export function createDb(connectionString: string): Db {
  const adapter = new PrismaPg({ connectionString, max: 5 });
  return new PrismaClient({ adapter });
}

export function isUniqueViolation(err: unknown, constraintHint?: string): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) {
    // Raw-query and adapter errors surface the Postgres code directly.
    const code = (err as { code?: string; cause?: { code?: string } } | null)?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
    if (code === '23505') return constraintHint ? String((err as Error).message).includes(constraintHint) : true;
    return false;
  }
  if (err.code !== 'P2002') return false;
  if (!constraintHint) return true;
  return JSON.stringify(err.meta ?? {}).includes(constraintHint) || err.message.includes(constraintHint);
}
