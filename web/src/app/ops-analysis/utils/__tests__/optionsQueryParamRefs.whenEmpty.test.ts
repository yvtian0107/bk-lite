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

  it('blocks an order catalog when the model ref is empty and still omits an optional classification', () => {
    const params = dynamicQueryParamsOf({
      control: 'order',
      optionsSource: {
        type: 'dynamic',
        valueField: 'key',
        labelField: 'label',
        queryParams: {
          classification_ids: { ref: 'classification_ids', whenEmpty: 'omit' },
          model_ids: { ref: 'model_ids' },
        },
      },
    });
    expect(resolveOptionsQueryParams(params, (ref) => (ref === 'classification_ids' ? [] : []))).toMatchObject({
      blocked: true,
      blockReason: 'empty',
      missingRefs: ['model_ids'],
    });
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
