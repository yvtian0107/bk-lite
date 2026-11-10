import { describe, expect, it } from 'vitest';

import {
  isParamConditionallyRequired,
  isParamVisible,
  sourceQueryBlockedByRequired,
} from '@/app/ops-analysis/utils/paramVisibility';

describe('param visibility', () => {
  it('uses the same rule for visibility and conditional required', () => {
    const values = { analysis_mode: 'distribution' };
    const param = { visibleWhen: { param: 'analysis_mode', in: ['distribution'] }, requiredWhen: { param: 'analysis_mode', in: ['distribution'] } };

    expect(isParamVisible(param, values)).toBe(true);
    expect(isParamConditionallyRequired(param, values)).toBe(true);
    expect(isParamVisible(param, { analysis_mode: 'list' })).toBe(false);
    expect(isParamConditionallyRequired({ requiredWhen: param.requiredWhen }, { analysis_mode: 'list' })).toBe(false);
  });

  it('blocks the main query until a required model is chosen', () => {
    const params = [
      { name: 'analysis_mode', required: true },
      { name: 'model_ids', required: true },
      { name: 'conditions' },
    ];
    expect(sourceQueryBlockedByRequired(params, { analysis_mode: 'list', model_ids: [], conditions: { logic: 'and', children: [] } })).toBe(true);
    expect(sourceQueryBlockedByRequired(params, { analysis_mode: 'list', model_ids: ['host'] })).toBe(false);
  });

  it('does not treat a missing rule as required', () => {
    expect(isParamVisible({}, { analysis_mode: 'list' })).toBe(true);
    expect(isParamConditionallyRequired({}, { analysis_mode: 'list' })).toBe(false);
  });
});
