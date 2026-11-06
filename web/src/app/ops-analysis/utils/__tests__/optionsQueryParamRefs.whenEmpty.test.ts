import { describe, expect, it } from 'vitest';

import { dynamicQueryParamsOf, resolveOptionsQueryParams } from '@/app/ops-analysis/utils/optionsQueryParamRefs';

describe('options query whenEmpty', () => {
  it('omits an empty upstream only when the ref asks, and still blocks by default', () => {
    expect(resolveOptionsQueryParams(
      { classification_ids: { ref: 'classification_ids', whenEmpty: 'omit' } },
      () => [],
    )).toEqual({ blocked: false, params: {}, missingRefs: [] });

    expect(resolveOptionsQueryParams(
      { classification_ids: { ref: 'classification_ids' } },
      () => [],
    )).toMatchObject({ blocked: true, blockReason: 'empty' });
  });

  it('reads condition and field group query params without a source-specific branch', () => {
    const params = dynamicQueryParamsOf({
      control: 'condition',
      optionsSource: {
        type: 'dynamic',
        valueField: 'key',
        labelField: 'label',
        queryParams: { model_ids: { ref: 'model_ids', whenEmpty: 'omit' } },
      },
    });
    expect(params?.model_ids).toEqual({ ref: 'model_ids', whenEmpty: 'omit' });
  });
});
