import { describe, expect, it, afterEach } from 'vitest';
import {
  REFERENCE_LINE_COLOR_TOKEN,
  REFERENCE_SERIES_ID,
  appendReferenceSeries,
  readReferenceLines,
  resolveReferenceLineColor,
} from '../chartReferenceLines';
import { presentBar } from '../chartDisplay';
import { positiveSeriesMax } from '../chartSeriesExtent';

afterEach(() => {
  document.documentElement.style.removeProperty(REFERENCE_LINE_COLOR_TOKEN);
});

describe('reference lines', () => {
  it('keeps an explicit line on the left axis instead of the first series', () => {
    const series = appendReferenceSeries(
      [
        { name: 'small', yAxisIndex: 1, data: [1] },
        { name: 'large', yAxisIndex: 0, data: [80] },
      ],
      { referenceLines: [{ name: '告警', value: 80 }] },
    );

    expect(series[0]).not.toHaveProperty('markLine');
    expect(series[2]).toMatchObject({
      id: REFERENCE_SERIES_ID,
      yAxisIndex: 0,
    });
    expect(series[2].markLine.data[0]).toMatchObject({
      yAxis: 80,
      label: { formatter: '告警 80' },
    });
    expect(series.filter((item) => item.id === REFERENCE_SERIES_ID)).toHaveLength(1);
  });

  it('draws nothing when reference lines are configured empty', () => {
    const series = [{ name: 'cpu', data: [1] }];
    expect(appendReferenceSeries(series, {
      referenceLines: [],
      thresholdColors: [{ value: '80', color: '#ff4d4f' }],
    })).toBe(series);
    expect(readReferenceLines({ referenceLines: [] })).toEqual([]);
  });

  it('uses the theme failure token when a line has no color', () => {
    document.documentElement.style.setProperty('--theme-color-status-error', 'rgb(1, 2, 3)');
    document.documentElement.style.setProperty(
      REFERENCE_LINE_COLOR_TOKEN,
      'var(--theme-color-status-error)',
    );
    const series = appendReferenceSeries(
      [{ name: 'cpu', data: [1] }],
      { referenceLines: [{ name: '上限', value: 80 }] },
    );
    expect(series[1].markLine.data[0].lineStyle.color).toBe('rgb(1, 2, 3)');
    expect(resolveReferenceLineColor(undefined)).toBe('rgb(1, 2, 3)');
    expect(resolveReferenceLineColor(undefined)).not.toMatch(/#(?:ff4d4f|f5222d|dc2626|F43B2C)/i);
    document.documentElement.style.removeProperty('--theme-color-status-error');
  });
});

describe('chart redraw without display switches', () => {
  it('does not read raw points when bar limit and sort are off', () => {
    const chart = { categories: ['a'], values: [1] };
    const rawData = new Proxy({}, {
      get() {
        throw new Error('scanned');
      },
      ownKeys() {
        throw new Error('scanned');
      },
    });

    expect(presentBar(chart, {}, {
      rawData,
      mapping: undefined,
      otherName: '其他',
    })).toBe(chart);
  });

  it('finds a series maximum without spreading every point', () => {
    const values = Array.from({ length: 100_000 }, (_, index) => index);
    expect(positiveSeriesMax(values)).toBe(99_999);
  });
});
