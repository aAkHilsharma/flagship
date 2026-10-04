import { z } from 'zod';

export const roleSchema = z.enum(['admin', 'member', 'auditor']);
export type Role = z.infer<typeof roleSchema>;
export const keySchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{1,63}$/, 'Use 2–64 lowercase letters, digits or hyphens');
export const primitiveSchema = z.union([z.string().max(500), z.number().finite(), z.boolean()]);
export const conditionSchema = z
  .object({
    attribute: z
      .string()
      .min(1)
      .max(64)
      .refine((v) => !['__proto__', 'prototype', 'constructor'].includes(v)),
    operator: z.enum(['equals', 'in', 'contains']),
    value: z.union([primitiveSchema, z.array(primitiveSchema).max(100)]),
  })
  .strict()
  .superRefine((condition, ctx) => {
    if (condition.operator === 'in' && (!Array.isArray(condition.value) || !condition.value.length))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: 'is one of requires a non-empty list',
      });
    if (condition.operator !== 'in' && Array.isArray(condition.value))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: 'equals / contains requires one value, not a list',
      });
  });
export const ruleSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(100),
    conditions: z.array(conditionSchema).max(20),
    percentage: z.number().min(0).max(100),
    value: z.boolean(),
  })
  .strict();
export type Rule = z.infer<typeof ruleSchema>;
export const flagConfigSchema = z
  .object({
    enabled: z.boolean(),
    archived: z.boolean(),
    fallback: z.boolean(),
    rules: z
      .array(ruleSchema)
      .max(100)
      .refine((rs) => new Set(rs.map((r) => r.id)).size === rs.length, 'Rule IDs must be unique'),
  })
  .strict();
export type FlagConfig = z.infer<typeof flagConfigSchema>;
export const contextSchema = z
  .object({
    key: z.string().min(1).max(200),
    attributes: z.record(z.union([primitiveSchema, z.array(primitiveSchema).max(100)])).default({}),
  })
  .strict();
export type UserContext = z.infer<typeof contextSchema>;
export const configSnapshotSchema = z.object({
  applicationId: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  flags: z.array(
    z.object({ key: keySchema, version: z.number().int().positive(), config: flagConfigSchema }),
  ),
});
export type ConfigSnapshot = z.infer<typeof configSnapshotSchema>;
export type FlagDefinition = ConfigSnapshot['flags'][number];
export const emptyConfig: FlagConfig = {
  enabled: false,
  archived: false,
  fallback: false,
  rules: [],
};
export const evaluationSchema = z
  .object({ flagKey: keySchema, context: contextSchema, defaultValue: z.boolean() })
  .strict();
export type Evaluation = {
  value: boolean;
  reason: 'DEFAULT' | 'DISABLED' | 'RULE' | 'ROLLOUT_EXCLUDED' | 'FALLBACK';
  ruleId?: string;
};
