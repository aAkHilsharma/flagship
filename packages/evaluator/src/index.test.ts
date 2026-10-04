import { describe, it, expect } from 'vitest';
import { bucket, evaluate } from './index';
import type { FlagDefinition, Rule } from '@flagship/contracts';
import { ruleSchema } from '@flagship/contracts';
const rule = (percentage = 100): Rule => ({
  id: 'a',
  name: 'Employee',
  conditions: [{ attribute: 'employee', operator: 'equals', value: true }],
  percentage,
  value: true,
});
const flag = (rules = [rule()]): FlagDefinition => ({
  key: 'checkout',
  version: 1,
  config: { enabled: true, archived: false, fallback: false, rules },
});
describe('evaluation semantics', () => {
  it('rejects conditions that cannot be evaluated meaningfully', () => {
    const r = { ...rule(), id: '2a8c7d91-fdb0-47d2-a6fd-60dca5179a56' };
    expect(
      ruleSchema.safeParse({
        ...r,
        conditions: [{ attribute: 'country', operator: 'in', value: 'IN' }],
      }).success,
    ).toBe(false);
    expect(
      ruleSchema.safeParse({
        ...r,
        conditions: [{ attribute: 'country', operator: 'equals', value: ['IN'] }],
      }).success,
    ).toBe(false);
  });
  it('defaults only for missing/archived; disabled means false', () => {
    const user = { key: '1', attributes: {} };
    expect(evaluate(undefined, user, true).value).toBe(true);
    const f = flag();
    f.config.enabled = false;
    expect(evaluate(f, user, true).value).toBe(false);
    f.config.archived = true;
    expect(evaluate(f, user, true).value).toBe(true);
  });
  it('first match stops evaluation, even when excluded by its percentage', () => {
    expect(
      evaluate(
        flag([rule(0), { ...rule(), id: 'b', conditions: [] }]),
        { key: '1', attributes: { employee: true } },
        false,
      ),
    ).toMatchObject({ value: false, reason: 'ROLLOUT_EXCLUDED', ruleId: 'a' });
  });
  it('does not coerce types or match missing attributes', () => {
    expect(evaluate(flag(), { key: '1', attributes: { employee: 'true' } }, false).value).toBe(
      false,
    );
    expect(evaluate(flag(), { key: '1', attributes: {} }, false).value).toBe(false);
    expect(evaluate(flag(), { key: '1', attributes: { employee: true } }, false).value).toBe(true);
  });
  it('supports group membership and AND conditions', () => {
    const r = {
      ...rule(),
      conditions: [
        { attribute: 'groups', operator: 'contains' as const, value: 'staff' },
        { attribute: 'country', operator: 'in' as const, value: ['IN', 'GB'] },
      ],
    };
    expect(
      evaluate(flag([r]), { key: '1', attributes: { groups: ['staff'], country: 'IN' } }, false)
        .value,
    ).toBe(true);
    expect(
      evaluate(flag([r]), { key: '1', attributes: { groups: ['staff'], country: 'US' } }, false)
        .value,
    ).toBe(false);
  });
  it('is stable, approximately distributed, and monotonic as rollout increases', () => {
    const buckets = Array.from({ length: 10000 }, (_, i) => bucket('checkout', String(i)));
    expect(buckets.filter((v) => v < 1000).length).toBeGreaterThan(850);
    expect(buckets.filter((v) => v < 1000).length).toBeLessThan(1150);
    expect(bucket('checkout', 'same')).toBe(bucket('checkout', 'same'));
    for (let i = 0; i < 500; i++) {
      const u = { key: String(i), attributes: { employee: true } };
      if (evaluate(flag([rule(10)]), u, false).value)
        expect(evaluate(flag([rule(20)]), u, false).value).toBe(true);
    }
  });
});
