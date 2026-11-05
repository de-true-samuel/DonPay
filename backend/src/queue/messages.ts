import { z } from 'zod';

/** Every message on the single work queue. Validated on consume. */
export const queueMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('kora.verify'), reference: z.string(), webhookEventId: z.string().nullable() }),
  z.object({ type: z.literal('request.checkExpiry'), requestId: z.string() }),
  z.object({ type: z.literal('notify.send'), notificationId: z.string() }),
  z.object({ type: z.literal('digest.build'), providerId: z.string(), date: z.string() }),
]);

export type QueueMessage = z.infer<typeof queueMessageSchema>;
