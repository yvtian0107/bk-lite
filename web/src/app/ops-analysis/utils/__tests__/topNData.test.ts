import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTopNItems,
  coerceTopNNumericValue,
  resolveTopNBarPercent,
  resolveTopNMaxValue,
} from '../topNData';

test('numeric strings coerce, IPs and blanks stay empty', () => {
  assert.equal(coerceTopNNumericValue('208036'), 208036);
  assert.equal(coerceTopNNumericValue(208036), 208036);
  assert.equal(coerceTopNNumericValue('0'), 0);
  assert.equal(coerceTopNNumericValue('10.51.176.171'), null);
  assert.equal(coerceTopNNumericValue(''), null);
  assert.equal(coerceTopNNumericValue(true), null);
});

test('log top rows keep names and convert string hits', () => {
  const items = buildTopNItems(
    [
      { value: '208036', name: '10.51.176.171' },
      { value: 'not-a-number', name: '10.51.176.50' },
    ],
    'name',
    'value',
  );

  assert.deepEqual(items, [
    {
      name: '10.51.176.171',
      value: 208036,
      source: { value: '208036', name: '10.51.176.171' },
    },
    {
      name: '10.51.176.50',
      value: null,
      source: { value: 'not-a-number', name: '10.51.176.50' },
    },
  ]);
  assert.equal(resolveTopNMaxValue(items), 208036);
  assert.equal(resolveTopNBarPercent(items[1].value, 208036), 0);
});

test('ranking rows sort by value descending and keep ties in input order', () => {
  const items = buildTopNItems(
    [
      { classification_name: '中间件', value: 2 },
      { classification_name: '主机', value: 9 },
      { classification_name: '数据库', value: 9 },
      { classification_name: '空分类', value: null },
      { classification_name: '网络', value: 4 },
    ],
    'classification_name',
    'value',
  );

  assert.deepEqual(items.map((item) => item.name), ['主机', '数据库', '网络', '中间件', '空分类']);
  assert.deepEqual(items.map((item) => item.value), [9, 9, 4, 2, null]);
});
