import assert from 'node:assert/strict';
import test from 'node:test';
import { screenWidgetInspectorTabs } from '../inspectorTabs';

test('single value widgets insert a style tab between data and interaction', () => {
  assert.deepEqual(screenWidgetInspectorTabs('single', true), [
    'data',
    'singleStyle',
    'interaction',
  ]);
  assert.deepEqual(screenWidgetInspectorTabs('single', false), [
    'style',
    'data',
    'singleStyle',
    'interaction',
  ]);
});

test('other widgets keep the existing inspector tabs', () => {
  assert.deepEqual(screenWidgetInspectorTabs('line', true), ['data', 'interaction']);
  assert.deepEqual(screenWidgetInspectorTabs('line', false), [
    'style',
    'data',
    'interaction',
  ]);
});
