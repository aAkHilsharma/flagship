import type { Evaluation, FlagDefinition, Rule, UserContext } from '@flagship/contracts';

// FNV-1a over UTF-8. Length-delimited input prevents ambiguous flag/user pairs.
// Rule ID is deliberately excluded: reordering rules does not reshuffle users.
export function bucket(flagKey: string, userKey: string): number {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(JSON.stringify([flagKey, userKey]))) {
    hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  }
  return hash % 10000;
}

export function matches(rule: Rule, context: UserContext): boolean {
  return rule.conditions.every((condition) => {
    const actual =
      condition.attribute === 'key'
        ? context.key
        : Object.hasOwn(context.attributes, condition.attribute)
          ? context.attributes[condition.attribute]
          : undefined;
    if (actual === undefined) return false;
    switch (condition.operator) {
      case 'equals':
        return actual === condition.value;
      case 'in':
        return (
          Array.isArray(condition.value) &&
          !Array.isArray(actual) &&
          condition.value.includes(actual)
        );
      case 'contains':
        return (
          Array.isArray(actual) &&
          !Array.isArray(condition.value) &&
          actual.includes(condition.value)
        );
    }
  });
}

export function evaluate(
  flag: FlagDefinition | undefined,
  context: UserContext,
  defaultValue: boolean,
): Evaluation {
  if (!flag || flag.config.archived) return { value: defaultValue, reason: 'DEFAULT' };
  if (!flag.config.enabled) return { value: false, reason: 'DISABLED' };
  const rule = flag.config.rules.find((rule) => matches(rule, context));
  if (!rule) return { value: flag.config.fallback, reason: 'FALLBACK' };
  // First matching rule is terminal, even if the user is outside its rollout.
  const included = bucket(flag.key, context.key) < Math.round(rule.percentage * 100);
  return {
    value: included ? rule.value : flag.config.fallback,
    reason: included ? 'RULE' : 'ROLLOUT_EXCLUDED',
    ruleId: rule.id,
  };
}
