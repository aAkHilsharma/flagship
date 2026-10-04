import { useState, type Dispatch, type SetStateAction } from 'react';
import { ArrowUp, ArrowDown, ChevronUp, Info, Plus, Trash2, X } from 'lucide-react';
import { flagConfigSchema, type FlagConfig, type Rule } from '@flagship/contracts';
import type { Flag } from '../../lib/api';
import { FlagSteps } from './FlagSteps';
import { ValueControl, attributes, countries, ruleSummary, type Condition } from './conditions';

export function TargetingRules({
  flag,
  config,
  setConfig,
  admin,
  busy,
  onCancel,
  onSave,
}: {
  flag: Flag;
  config: FlagConfig;
  setConfig: Dispatch<SetStateAction<FlagConfig>>;
  admin: boolean;
  busy: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(config.rules.at(-1)?.id ?? null);
  const changed = JSON.stringify(config) !== JSON.stringify(flag.config);
  const validation = flagConfigSchema.safeParse(config);
  const patchRule = (id: string, patch: Partial<Rule>) =>
    setConfig((c) => ({ ...c, rules: c.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  function move(index: number, delta: number) {
    setConfig((c) => {
      const rules = [...c.rules];
      [rules[index], rules[index + delta]] = [rules[index + delta], rules[index]];
      return { ...c, rules };
    });
  }
  return (
    <>
      <FlagSteps targeting />
      <datalist id="country-values">
        {Object.entries(countries).map(([code, name]) => (
          <option value={code} key={code}>
            {name}
          </option>
        ))}
      </datalist>
      <datalist id="plan-values">
        <option value="free" />
        <option value="premium" />
        <option value="enterprise" />
      </datalist>
      <div className="detail-columns targeting-columns">
        <section className="detail-panel targeting-panel">
          <h2>Targeting rules</h2>
          <p className="panel-description">
            Rules run from top to bottom. The first matching rule wins.
          </p>
          <fieldset className="unstyled" disabled={!admin || busy}>
            {config.rules.map((rule, index) => {
              const open = expanded === rule.id;
              const unsaved = JSON.stringify(rule) !== JSON.stringify(flag.config.rules[index]);
              const patchCondition = (ci: number, patch: Partial<Condition>) =>
                patchRule(rule.id, {
                  conditions: rule.conditions.map((c, i) => (ci === i ? { ...c, ...patch } : c)),
                });
              return (
                <section className={'targeting-rule' + (open ? ' expanded' : '')} key={rule.id}>
                  <header>
                    <span className="rule-bubble">{index + 1}</span>
                    <div className="rule-heading">
                      <strong>{rule.name || 'Untitled rule'}</strong>
                      {unsaved && <span className="unsaved-badge">Unsaved</span>}
                      {!open && (
                        <p>
                          {ruleSummary(rule)} · Rollout {rule.percentage}%
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      className="secondary compact"
                      onClick={() => setExpanded(open ? null : rule.id)}
                    >
                      {open ? <ChevronUp size={17} /> : 'Edit'}
                    </button>
                    <button
                      type="button"
                      className="icon-button danger"
                      aria-label={'Delete ' + rule.name}
                      onClick={() =>
                        setConfig((c) => ({ ...c, rules: c.rules.filter((r) => r.id !== rule.id) }))
                      }
                    >
                      <Trash2 size={17} />
                    </button>
                  </header>
                  {open && (
                    <div className="rule-fields">
                      <label>
                        Rule name
                        <input
                          value={rule.name}
                          maxLength={100}
                          onChange={(e) => patchRule(rule.id, { name: e.target.value })}
                        />
                      </label>
                      <div className="audience-heading">
                        <strong>Audience</strong>
                        <span>Match ALL conditions</span>
                        <div className="rule-order">
                          <button
                            type="button"
                            className="icon-button"
                            aria-label="Move rule up"
                            disabled={index === 0}
                            onClick={() => move(index, -1)}
                          >
                            <ArrowUp size={15} />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label="Move rule down"
                            disabled={index === config.rules.length - 1}
                            onClick={() => move(index, 1)}
                          >
                            <ArrowDown size={15} />
                          </button>
                        </div>
                      </div>
                      {!rule.conditions.length && (
                        <p className="muted">Everyone matches this rule.</p>
                      )}
                      <div className="audience-conditions">
                        {rule.conditions.map((c, ci) => (
                          <div className="audience-condition" key={ci}>
                            {ci > 0 && <span className="and-label">AND</span>}
                            <select
                              aria-label="Attribute"
                              value={c.attribute}
                              onChange={(e) => {
                                const attribute = e.target.value;
                                patchCondition(ci, {
                                  attribute,
                                  operator: 'equals',
                                  value:
                                    attribute === 'employee'
                                      ? true
                                      : attribute === 'country'
                                        ? 'IN'
                                        : attribute === 'plan'
                                          ? 'premium'
                                          : '',
                                });
                              }}
                            >
                              {!attributes.includes(c.attribute) && (
                                <option value={c.attribute}>{c.attribute}</option>
                              )}
                              {attributes.map((a) => (
                                <option key={a} value={a}>
                                  {a === 'key' ? 'User ID' : a}
                                </option>
                              ))}
                            </select>
                            <select
                              aria-label="Operator"
                              value={c.operator}
                              onChange={(e) => {
                                const operator = e.target.value as Condition['operator'];
                                patchCondition(ci, {
                                  operator,
                                  value:
                                    operator === 'in'
                                      ? Array.isArray(c.value)
                                        ? c.value
                                        : [c.value]
                                      : Array.isArray(c.value)
                                        ? (c.value[0] ?? '')
                                        : c.value,
                                });
                              }}
                            >
                              <option value="equals">equals</option>
                              {c.attribute !== 'employee' && (
                                <>
                                  <option value="in">is one of</option>
                                  <option value="contains">contains</option>
                                </>
                              )}
                            </select>
                            <ValueControl
                              key={c.attribute + c.operator}
                              condition={c}
                              onChange={(value) => patchCondition(ci, { value })}
                            />
                            <button
                              type="button"
                              className="icon-button"
                              aria-label="Remove condition"
                              onClick={() =>
                                patchRule(rule.id, {
                                  conditions: rule.conditions.filter((_, i) => ci !== i),
                                })
                              }
                            >
                              <X size={16} />
                            </button>
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="secondary compact add-condition"
                        onClick={() =>
                          patchRule(rule.id, {
                            conditions: [
                              ...rule.conditions,
                              { attribute: 'country', operator: 'equals', value: 'IN' },
                            ],
                          })
                        }
                      >
                        <Plus size={15} />
                        Add condition
                      </button>
                      <div className="rule-rollout">
                        <label>
                          Rollout
                          <div className="percentage-input">
                            <input
                              aria-label="Rollout percentage"
                              type="number"
                              min={0}
                              max={100}
                              step={0.01}
                              value={rule.percentage}
                              onChange={(e) =>
                                patchRule(rule.id, { percentage: Number(e.target.value) })
                              }
                            />
                            <span>%</span>
                          </div>
                        </label>
                        <div className="rollout-slider">
                          <input
                            aria-label="Rollout slider"
                            type="range"
                            min={0}
                            max={100}
                            value={rule.percentage}
                            onChange={(e) =>
                              patchRule(rule.id, { percentage: Number(e.target.value) })
                            }
                          />
                          <div>
                            <span>0%</span>
                            <span>100%</span>
                          </div>
                          <small>
                            Serve {rule.value ? 'enabled' : 'disabled'} for {rule.percentage}% of
                            users who match this audience.
                          </small>
                        </div>
                      </div>
                      <div className="assignment-row">
                        <span>Keep assignment consistent by</span>
                        <span className="assignment-value">User ID</span>
                        <label>
                          Serve
                          <select
                            value={String(rule.value)}
                            onChange={(e) =>
                              patchRule(rule.id, { value: e.target.value === 'true' })
                            }
                          >
                            <option value="true">Enabled</option>
                            <option value="false">Disabled</option>
                          </select>
                        </label>
                      </div>
                    </div>
                  )}
                </section>
              );
            })}
            <button
              type="button"
              className="secondary add-condition"
              onClick={() => {
                const id = crypto.randomUUID();
                setConfig((c) => ({
                  ...c,
                  rules: [
                    ...c.rules,
                    { id, name: 'New rule', conditions: [], percentage: 100, value: true },
                  ],
                }));
                setExpanded(id);
              }}
            >
              <Plus size={16} />
              Add another rule
            </button>
            <div className="targeting-default">
              <label>
                Everyone else
                <select
                  value={String(config.fallback)}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, fallback: e.target.value === 'true' }))
                  }
                >
                  <option value="false">Off</option>
                  <option value="true">On</option>
                </select>
              </label>
              <small>Also applies to users outside a matched rule’s rollout percentage.</small>
            </div>
          </fieldset>
        </section>
        <aside className="targeting-aside">
          <section className="detail-panel rule-summary">
            <h2>Rule summary</h2>
            <p>When enabled, rules are checked in this order:</p>
            {config.rules.map((r, i) => (
              <div key={r.id}>
                <span className="rule-bubble">{i + 1}</span>
                <p>
                  {r.percentage}% of users matching {ruleSummary(r)} → {r.value ? 'On' : 'Off'}
                </p>
              </div>
            ))}
            {!config.rules.length && <p>No targeting rules yet.</p>}
            <footer>
              <span>Everyone else</span>
              <strong>{config.fallback ? 'On' : 'Off'}</strong>
            </footer>
          </section>
          <div className="disabled-callout">
            <Info size={24} />
            <div>
              <strong>Flag is currently {flag.config.enabled ? 'enabled' : 'disabled'}</strong>
              <p>
                {flag.config.enabled
                  ? 'Saved rules will affect the active rollout.'
                  : 'Saving rules won’t enable the flag.'}
              </p>
            </div>
          </div>
        </aside>
      </div>
      {!validation.success && (
        <p className="error" role="alert">
          {validation.error.issues[0]?.message}
        </p>
      )}
      <footer className="rules-savebar">
        <span>
          {config.rules.length} rules{changed ? ' · Unsaved changes' : ''}
        </span>
        <div>
          <button className="secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          {admin && (
            <button
              className="primary"
              disabled={busy || !changed || !validation.success}
              onClick={onSave}
            >
              {busy ? 'Saving…' : 'Save rules'}
            </button>
          )}
        </div>
      </footer>
    </>
  );
}
