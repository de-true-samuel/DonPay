/**
 * Demo seed: "Tolu's Glam Studio" with a believable week of jobs in every Today bucket.
 * Runs in Node against DATABASE_URL. Uses the real services so data obeys the same rules as the app.
 *
 *   npm run db:seed
 *
 * Log in afterwards with dev login: POST /api/auth/dev-login { "businessName": "Tolu's Glam Studio" }
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma-node/client';
import type { Deps } from '../src/deps';
import { FakeKoraClient } from '../src/integrations/kora/fake-client';
import { ConsoleTelegramSender } from '../src/integrations/telegram/sender';
import { silentLogger } from '../src/log';
import { createJob } from '../src/services/jobs';
import { createBalanceRequest, sendRequest } from '../src/services/requests';
import { recordManualPayment } from '../src/services/payments';
import { simulatePayment } from '../src/services/dev';

const BUSINESS = "Tolu's Glam Studio";
const HOUR = 3_600_000;

async function main() {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) }) as unknown as Deps['db'];
  let now = new Date();
  const deps: Deps = {
    db,
    kora: new FakeKoraClient(60, () => now),
    telegram: new ConsoleTelegramSender(),
    queue: { send: async () => {} },
    config: {
      appEnv: 'local',
      publicBaseUrl: process.env.WORKER_URL ?? 'http://localhost:8787',
      frontendUrl: 'http://localhost:5173',
      frontendOrigins: [],
      cookieSameSite: 'Lax',
      koraMode: 'fake',
      koraBaseUrl: '',
      koraSecretKey: null,
      koraExpiryMinutes: 60,
      placeholderEmailDomain: 'customers.kobo-exact.app',
      devLoginEnabled: true,
      telegramBotToken: null,
      telegramBotUsername: null,
      telegramWebhookSecret: null,
      adminSecret: null,
    },
    now: () => now,
    log: silentLogger,
  };

  const key = BUSINESS.toLowerCase();
  const existing = await db.provider.findUnique({ where: { devLoginKey: key } });
  if (existing) {
    await db.provider.delete({ where: { id: existing.id } });
    console.log('Removed previous demo provider.');
  }
  const provider = await db.provider.create({ data: { businessName: BUSINESS, devLoginKey: key, digestMinuteOfDay: 19 * 60 } });
  const pid = provider.id;
  const at = (hoursAgo: number) => {
    now = new Date(Date.now() - hoursAgo * HOUR);
  };
  const ago = (hours: number) => new Date(Date.now() - hours * HOUR);
  const inDays = (days: number) => new Date(Date.now() + days * 24 * HOUR);

  // 1. Just paid, ready to start (deposit paid this morning).
  at(3);
  const bridal = await createJob(deps, pid, {
    customer: { name: 'Tolu Adeyemi', phone: '08031234567', messageConsent: true },
    service: 'Bridal makeup',
    totalKobo: 5_000_000n,
    plan: 'DEPOSIT_BALANCE',
    depositKobo: 2_500_000n,
    balanceDueAt: inDays(1),
    readyRule: 'AFTER_DEPOSIT',
    notes: 'Trial on Thursday, wedding Saturday 7am',
  });
  await sendRequest(deps, pid, bridal.requests[0]!.id);
  at(2);
  await simulatePayment(deps, pid, bridal.requests[0]!.id, { payerName: 'ADEYEMI TOLULOPE' });

  // 2. Fully paid job from earlier in the week.
  at(72);
  const gele = await createJob(deps, pid, { customer: { name: 'Funke Bello', phone: '08025550101' }, service: 'Gele tying (3 people)', totalKobo: 1_500_000n, plan: 'FULL' });
  await sendRequest(deps, pid, gele.requests[0]!.id);
  at(71);
  await simulatePayment(deps, pid, gele.requests[0]!.id, { payerName: 'BELLO FUNKE' });

  // 3. Waiting: request sent 20 minutes ago.
  at(0.33);
  const birthday = await createJob(deps, pid, {
    customer: { name: 'Chiamaka Obi', phone: '07061230000' },
    service: 'Birthday shoot makeup',
    totalKobo: 3_500_000n,
    plan: 'DEPOSIT_BALANCE',
    depositKobo: 1_500_000n,
    readyRule: 'AFTER_DEPOSIT',
  });
  await sendRequest(deps, pid, birthday.requests[0]!.id);

  // 4. Balance due today: deposit paid days ago, balance not yet requested.
  at(96);
  const owambe = await createJob(deps, pid, {
    customer: { name: 'Kemi Ogunleye', phone: '08187776655' },
    service: 'Owambe glam (bride + 2)',
    totalKobo: 9_000_000n,
    plan: 'DEPOSIT_BALANCE',
    depositKobo: 4_500_000n,
    balanceDueAt: new Date(Date.now() + 2 * HOUR),
    readyRule: 'AFTER_DEPOSIT',
  });
  await sendRequest(deps, pid, owambe.requests[0]!.id);
  at(95);
  await simulatePayment(deps, pid, owambe.requests[0]!.id, { payerName: 'OGUNLEYE KEMI' });

  // 5. Expired: request sent yesterday, never paid.
  at(26);
  const studio = await createJob(deps, pid, { customer: { name: 'Ngozi Eze', phone: '09012345678' }, service: 'Studio portrait makeup', totalKobo: 2_000_000n, plan: 'FULL' });
  await sendRequest(deps, pid, studio.requests[0]!.id);
  at(24);
  await db.paymentRequest.update({ where: { id: studio.requests[0]!.id }, data: { status: 'EXPIRED', expiredAt: ago(24) } });

  // 6. Needs review: payer name looks different.
  at(5);
  const lesson = await createJob(deps, pid, { customer: { name: 'Aisha Musa', phone: '08033334444' }, service: 'Self-makeup class', totalKobo: 2_500_000n, plan: 'FULL' });
  await sendRequest(deps, pid, lesson.requests[0]!.id);
  const lessonReq = await db.paymentRequest.findUniqueOrThrow({ where: { id: lesson.requests[0]!.id } });
  // Recorded as a real (non-simulated) charge so the payer-name check runs.
  const { recordVerifiedCharge } = await import('../src/services/payments');
  at(4.5);
  await recordVerifiedCharge(
    deps,
    {
      reference: lessonReq.koraReference!,
      state: 'success',
      rawStatus: 'success',
      amountAcceptedKobo: 2_500_000n,
      amountExpectedKobo: 2_500_000n,
      feeKobo: 0n,
      payerName: 'IBRAHIM YUSUF',
      payerBank: 'Access Bank',
      payerAccountNumber: '0011223344',
      transactionReference: 'SEED-1',
      simulated: false,
    },
    null,
  );

  // 7. Part-paid with a cash entry (not verified by Kora), and a not-started draft.
  at(48);
  const lashes = await createJob(deps, pid, {
    customer: { name: 'Bisi Lawal', phone: '08122223333' },
    service: 'Lash extensions',
    totalKobo: 1_800_000n,
    plan: 'DEPOSIT_BALANCE',
    depositKobo: 800_000n,
    readyRule: 'AFTER_DEPOSIT',
  });
  await db.paymentRequest.update({ where: { id: lashes.requests[0]!.id }, data: { status: 'CANCELLED', cancelledAt: ago(47) } });
  await recordManualPayment(deps, pid, lashes.id, { amountKobo: 800_000n, note: 'Paid cash at the studio' });
  at(1);
  await createBalanceRequest(deps, pid, lashes.id, { send: false });

  at(0.1);
  await createJob(deps, pid, { customer: { name: 'Ifeoma Nwosu', phone: '08066667777' }, service: 'Graduation makeup', totalKobo: 2_200_000n, plan: 'FULL' });

  await db.$disconnect();
  console.log(`Seeded "${BUSINESS}" (provider ${pid}).`);
  console.log(`Dev login: POST /api/auth/dev-login {"businessName":"${BUSINESS}"}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
