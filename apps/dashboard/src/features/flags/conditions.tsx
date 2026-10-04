import { useState } from 'react';
import { X } from 'lucide-react';
import type { Rule } from '@flagship/contracts';

export type Condition = Rule['conditions'][number];
export const attributes = ['country', 'region', 'plan', 'employee', 'userType', 'email', 'key'];
export const countries: Record<string, string> = {
  IN: 'India',
  US: 'United States',
  GB: 'United Kingdom',
  CA: 'Canada',
  AU: 'Australia',
  DE: 'Germany',
  FR: 'France',
  SG: 'Singapore',
};
function displayValue(value: Condition['value']): string {
  return Array.isArray(value)
    ? value.map(displayValue).join(', ')
    : (countries[String(value)] ?? String(value));
}
export function ruleSummary(rule: Rule) {
  return rule.conditions.length
    ? rule.conditions
        .map(
          (c) =>
            `${c.attribute === 'key' ? 'User ID' : c.attribute} ${c.operator === 'in' ? 'is one of' : c.operator} ${displayValue(c.value)}`,
        )
        .join(' and ')
    : 'Everyone';
}

export function ValueControl({
  condition,
  onChange,
}: {
  condition: Condition;
  onChange: (value: Condition['value']) => void;
}) {
  const suggestions =
    condition.attribute === 'country'
      ? Object.entries(countries)
      : condition.attribute === 'plan'
        ? ['free', 'premium', 'enterprise'].map((x) => [x, x])
        : [];
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState('');
  if (typeof condition.value === 'boolean' && condition.operator !== 'in')
    return (
      <select
        aria-label="Employee status"
        value={String(condition.value)}
        onChange={(e) => onChange(e.target.value === 'true')}
      >
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  if (condition.operator === 'in') {
    const values = Array.isArray(condition.value) ? condition.value : [condition.value];
    return (
      <div className="value-chips">
        {values.map((v, i) => (
          <span key={i}>
            {displayValue(v)}
            <button
              type="button"
              aria-label={'Remove ' + v}
              onClick={() => onChange(values.filter((_, j) => i !== j))}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          aria-label="Add allowed value"
          placeholder="Add value…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft.trim()) {
              onChange([...new Set([...values, draft.trim()])]);
              setDraft('');
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              if (draft.trim()) {
                onChange([...new Set([...values, draft.trim()])]);
                setDraft('');
              }
            }
          }}
          list={
            condition.attribute === 'country'
              ? 'country-values'
              : condition.attribute === 'plan'
                ? 'plan-values'
                : undefined
          }
        />
      </div>
    );
  }
  if (suggestions.length && !custom)
    return (
      <select
        aria-label="Condition value"
        value={String(condition.value)}
        onChange={(e) => {
          if (e.target.value === '__custom') setCustom(true);
          else onChange(e.target.value);
        }}
      >
        {!suggestions.some(([v]) => v === String(condition.value)) && (
          <option value={String(condition.value)}>
            {String(condition.value) || 'Choose a value'}
          </option>
        )}
        {suggestions.map(([v, label]) => (
          <option value={v} key={v}>
            {label}
          </option>
        ))}
        <option value="__custom">Custom value…</option>
      </select>
    );
  return (
    <input
      aria-label="Condition value"
      type={typeof condition.value === 'number' ? 'number' : 'text'}
      value={String(condition.value)}
      onChange={(e) =>
        onChange(typeof condition.value === 'number' ? Number(e.target.value) : e.target.value)
      }
    />
  );
}
