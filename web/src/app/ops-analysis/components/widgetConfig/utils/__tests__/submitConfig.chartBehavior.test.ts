import { describe, expect, it } from 'vitest';
import {
  buildWidgetSubmitConfig,
  dashboardWidgetValueConfigPatch,
  mergeSanitizedWidgetValueConfig,
  mergeScreenWidgetValueConfig,
} from '../submitConfig';

const baseInput = {
  showChartThemeMode: false,
  showTableFilterFields: false,
  selectedFields: [] as string[],
  thresholdColors: [],
  filterBindings: {},
  displayColumns: [],
  filterFields: [],
};

describe('chart behavior config', () => {
  it('saves bar stack and named reference lines, and drops a blank line', () => {
    const saved = buildWidgetSubmitConfig({
      ...baseInput,
      chartType: 'bar',
      values: {
        name: '柱状',
        chartType: 'bar',
        dimensionField: 'name',
        valueFields: ['value'],
        stack: true,
        referenceLines: [
          { name: '告警', value: 80 },
          { name: '  ', value: 10 },
          { value: 5 },
        ],
      },
    });
    const plain = buildWidgetSubmitConfig({
      ...baseInput,
      chartType: 'bar',
      values: {
        name: '柱状',
        chartType: 'bar',
        dimensionField: 'name',
        valueFields: ['value'],
        stack: false,
        referenceLines: [],
      },
    });

    expect(saved.error).toBeUndefined();
    expect(saved.config?.stack).toBe(true);
    expect(saved.config?.referenceLines).toEqual([{ name: '告警', value: 80 }]);
    expect(plain.config?.stack).toBeUndefined();
    expect(plain.config?.referenceLines).toBeUndefined();
  });

  it('stores auto scroll speed in milliseconds and omits it while the switch is off', () => {
    const saved = buildWidgetSubmitConfig({
      ...baseInput,
      forPreview: true,
      chartType: 'eventTable',
      values: {
        name: '事件',
        chartType: 'eventTable',
        autoScrollEnabled: true,
        autoScrollIntervalSec: 3,
      },
    });
    const manual = buildWidgetSubmitConfig({
      ...baseInput,
      forPreview: true,
      chartType: 'table',
      values: {
        name: '表格',
        chartType: 'table',
        autoScrollEnabled: false,
        autoScrollIntervalSec: 3,
      },
    });

    expect(saved.config?.autoScroll).toEqual({ enabled: true, intervalMs: 3000 });
    expect(manual.config?.autoScroll).toBeUndefined();
  });

  it('clears a turned-off stack, reference line, and auto scroll on the next save', () => {
    const saved = buildWidgetSubmitConfig({
      ...baseInput,
      chartType: 'bar',
      values: {
        name: '柱状',
        chartType: 'bar',
        dimensionField: 'name',
        valueFields: ['value'],
        stack: true,
        referenceLines: [{ name: '告警', value: 80 }],
      },
    });
    const cleared = buildWidgetSubmitConfig({
      ...baseInput,
      chartType: 'bar',
      values: {
        name: '柱状',
        chartType: 'bar',
        dimensionField: 'name',
        valueFields: ['value'],
        stack: false,
        referenceLines: [],
      },
    });
    expect(saved.config).toBeTruthy();
    expect(cleared.config).toBeTruthy();
    const screen = mergeScreenWidgetValueConfig(
      {
        chartType: 'bar',
        stack: true,
        referenceLines: [{ name: '告警', value: 80 }],
      },
      cleared.config!,
      'bar',
    );
    expect(screen.stack).toBeUndefined();
    expect(screen.referenceLines).toBeUndefined();

    const scrolling = buildWidgetSubmitConfig({
      ...baseInput,
      forPreview: true,
      chartType: 'table',
      values: {
        name: '表格',
        chartType: 'table',
        autoScrollEnabled: false,
        autoScrollIntervalSec: 3,
      },
    });
    const stopped = mergeScreenWidgetValueConfig(
      { chartType: 'table', autoScroll: { enabled: true, intervalMs: 3000 } },
      scrolling.config!,
      'table',
    );
    expect(stopped.autoScroll).toBeUndefined();

    const dashboard = mergeSanitizedWidgetValueConfig(
      { chartType: 'table', autoScroll: { enabled: true, intervalMs: 3000 } },
      dashboardWidgetValueConfigPatch(scrolling.config!),
      'table',
    );
    expect(dashboard.autoScroll).toBeUndefined();
    const kept = mergeSanitizedWidgetValueConfig(
      { chartType: 'table' },
      dashboardWidgetValueConfigPatch(saved.config!),
      'bar',
    );
    expect(kept.stack).toBe(true);
    expect(kept.referenceLines).toEqual([{ name: '告警', value: 80 }]);
  });
});
