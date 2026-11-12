import { zValidator } from '@hono/zod-validator';
import type { ValidationTargets } from 'hono';
import { z } from 'zod';
import { parseKoboInput } from '../domain/money';
import { normalizeNigerianPhone } from '../domain/phone';
import { parseHHMM } from '../domain/time';
import { AppError } from '../errors';

/** zValidator that reports failures in the contract's VALIDATION_ERROR shape. */
export const validate = <T extends z.ZodType, Target extends keyof ValidationTargets>(target: Target, schema: T) =>
  zValidator(target, schema, (result) => {
    if (!result.success) {
      const error = result.error as unknown as z.ZodError;
      const flat = z.flattenError(error);
      const fieldErrors: Record<string, string[]> = { ...(flat.fieldErrors as Record<string, string[]>) };
      // Surface nested paths (e.g. customer.phone) that flattenError folds into the parent key.
      for (const issue of error.issues) {
        if (issue.path.length > 1) {
          const key = issue.path.join('.');
          (fieldErrors[key] ??= []).push(issue.message);
        }
      }
      throw new AppError('VALIDATION_ERROR', 'Some fields are invalid', { fieldErrors, formErrors: flat.formErrors });
    }
  });

export const kobo = z.union([z.string(), z.number()]).transform((v, ctx) => {
  try {
    return parseKoboInput(v);
  } catch (e) {
    ctx.addIssue({ code: 'custom', message: (e as Error).message });
    return z.NEVER;
  }
});

export const positiveKobo = kobo.refine((v) => v > 0n, 'Amount must be greater than zero');

export const isoDate = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

export const phone = z
  .string()
  .min(7)
  .max(20)
  .refine((v) => normalizeNigerianPhone(v) != null, 'Enter a valid Nigerian phone number');

export const hhmm = z.string().refine((v) => parseHHMM(v) != null, 'Use HH:MM (24-hour)');

export const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).optional(),
});

export const readyRule = z.enum(['AFTER_DEPOSIT', 'AFTER_FULL']);
export const messageLanguage = z.enum(['en', 'pcm']);
export const paymentPlan = z.enum(['FULL', 'DEPOSIT_BALANCE']);
export const jobStatus = z.enum(['NOT_STARTED', 'PART_PAID', 'FULLY_PAID', 'CANCELLED']);
export const searchStatus = z.enum(['paid', 'waiting', 'balance_due', 'expired', 'needs_review']);
export const savedView = z.enum(['unpaid_balances', 'this_week', 'needs_follow_up']);
