import { describe, expect, it } from 'vitest';

import { resolveInteractionMenuScale } from '@/app/ops-analysis/utils/interactionMenuScale';

const screen = (
  overrides: Partial<Parameters<typeof resolveInteractionMenuScale>[0]> = {},
) => ({
  enabled: true,
  fitScale: 1,
  scaleX: 1,
  scaleY: 1,
  screenDensity: 1,
  screenUiScale: 1,
  widgetDensity: 1,
  widgetUiScale: 1,
  ...overrides,
});

describe('interaction menu scale', () => {
  it('stays at 1 outside a big screen', () => {
    expect(resolveInteractionMenuScale(null)).toBe(1);
    expect(resolveInteractionMenuScale(undefined)).toBe(1);
    expect(resolveInteractionMenuScale(screen({
      enabled: false,
      fitScale: 3,
      scaleX: 3,
      scaleY: 3,
      widgetUiScale: 2,
    }))).toBe(1);
  });

  it('clamps a canvas scale below 1 up to 1', () => {
    expect(resolveInteractionMenuScale(screen({
      fitScale: 0.4,
      scaleX: 0.4,
      scaleY: 0.4,
      widgetUiScale: 1,
    }))).toBe(1);
  });

  it('clamps a canvas scale above 1.6 down to 1.6', () => {
    expect(resolveInteractionMenuScale(screen({
      fitScale: 2,
      scaleX: 2,
      scaleY: 2,
      widgetUiScale: 1.2,
    }))).toBe(1.6);
  });

  it('multiplies the uniform canvas scale by the widget ui scale', () => {
    expect(resolveInteractionMenuScale(screen({
      fitScale: 1,
      scaleX: 1.25,
      scaleY: 1.25,
      widgetUiScale: 1.2,
      screenUiScale: 2,
    }))).toBe(1.5);
  });

  it('uses fitScale when the canvas is stretched on both axes', () => {
    expect(resolveInteractionMenuScale(screen({
      fitScale: 1.25,
      scaleX: 2,
      scaleY: 1,
      widgetUiScale: 1,
    }))).toBe(1.25);
  });
});
