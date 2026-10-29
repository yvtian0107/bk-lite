import { describe, expect, it } from 'vitest';
import { scaleScreenMetric } from '@/app/ops-analysis/components/widgets/shared/screenMetrics';
import { resolveCanvasContentScale } from '@/app/ops-analysis/utils/interactionMenuScale';
import {
  calculateScreenFitMetrics,
  calculateScreenVisualMetrics,
  mapDesignBoxToViewportPixels,
  presentScreenRenderContext,
  scalePresentedFontPx,
} from '../metrics';

describe('calculateScreenFitMetrics adapters', () => {
  it('fill stretches each axis to the window and does not scroll', () => {
    const fit = calculateScreenFitMetrics({
      contentWidth: 1920,
      contentHeight: 1200,
      designWidth: 1920,
      designHeight: 1080,
      adapter: 'fill',
    });

    expect(fit.scaleX).toBe(1);
    expect(fit.scaleY).toBeCloseTo(1200 / 1080);
    expect(fit.renderedWidth).toBe(1920);
    expect(fit.renderedHeight).toBe(1200);
    expect(fit.overflowX).toBe(false);
    expect(fit.overflowY).toBe(false);
  });

  it('contain letterboxes a taller screen without scrolling', () => {
    const fit = calculateScreenFitMetrics({
      contentWidth: 1920,
      contentHeight: 1200,
      designWidth: 1920,
      designHeight: 1080,
      adapter: 'contain',
    });

    expect(fit.scaleX).toBe(1);
    expect(fit.scaleY).toBe(1);
    expect(fit.renderedWidth).toBe(1920);
    expect(fit.renderedHeight).toBe(1080);
    expect(fit.overflowX).toBe(false);
    expect(fit.overflowY).toBe(false);
  });

  it('fitWidth on a taller screen matches the width and leaves vertical space', () => {
    const fit = calculateScreenFitMetrics({
      contentWidth: 1920,
      contentHeight: 1200,
      designWidth: 1920,
      designHeight: 1080,
      adapter: 'fitWidth',
    });

    expect(fit.scaleX).toBe(1);
    expect(fit.scaleY).toBe(1);
    expect(fit.overflowX).toBe(false);
    expect(fit.overflowY).toBe(false);
  });

  it('fitHeight on a taller screen scales uniformly and scrolls sideways', () => {
    const fit = calculateScreenFitMetrics({
      contentWidth: 1920,
      contentHeight: 1200,
      designWidth: 1920,
      designHeight: 1080,
      adapter: 'fitHeight',
    });

    expect(fit.scaleX).toBeCloseTo(1200 / 1080);
    expect(fit.scaleY).toBeCloseTo(1200 / 1080);
    expect(fit.renderedHeight).toBe(1200);
    expect(fit.renderedWidth).toBe(Math.round(1920 * (1200 / 1080)));
    expect(fit.overflowX).toBe(true);
    expect(fit.overflowY).toBe(false);
  });

  it('fitWidth on an ultrawide screen scales uniformly and scrolls vertically', () => {
    const fit = calculateScreenFitMetrics({
      contentWidth: 2560,
      contentHeight: 1080,
      designWidth: 1920,
      designHeight: 1080,
      adapter: 'fitWidth',
    });

    expect(fit.scaleX).toBeCloseTo(2560 / 1920);
    expect(fit.scaleY).toBeCloseTo(2560 / 1920);
    expect(fit.renderedWidth).toBe(2560);
    expect(fit.overflowX).toBe(false);
    expect(fit.overflowY).toBe(true);
  });

  it('defaults missing adapter to fill', () => {
    const withDefault = calculateScreenFitMetrics({
      contentWidth: 1920,
      contentHeight: 1200,
      designWidth: 1920,
      designHeight: 1080,
    });
    const fill = calculateScreenFitMetrics({
      contentWidth: 1920,
      contentHeight: 1200,
      designWidth: 1920,
      designHeight: 1080,
      adapter: 'fill',
    });

    expect(withDefault).toEqual(fill);
  });
});

describe('viewport pixel font scale', () => {
  // 2304×1400 对 1920×1080：sx=1.2，sy=1400/1080，密度取 min=1.2。
  // 旧补偿 screenDensity/fitScale 约为 1.16/1.2，再乘外层倍数会把 20px 变成另一档。
  const visual = calculateScreenVisualMetrics({
    contentWidth: 2304,
    contentHeight: 1400,
    designWidth: 1920,
    designHeight: 1080,
    adapter: 'fill',
  });

  it('keeps independent fill axis scales', () => {
    expect(visual.scaleX).toBeCloseTo(1.2);
    expect(visual.scaleY).toBeCloseTo(1400 / 1080);
    expect(visual.fitScale).toBeCloseTo(1.2);
  });

  it('sizes fullscreen fill text by fitScale once', () => {
    const presented = presentScreenRenderContext({
      layoutMode: 'viewportPixels',
      fitScale: visual.fitScale,
      scaleX: visual.scaleX,
      scaleY: visual.scaleY,
      screenDensity: visual.screenDensity,
      transformUiScale: visual.screenUiScale,
    });

    expect(presented.context.layoutMode).toBe('viewportPixels');
    expect(presented.context.scaleX).toBeCloseTo(1.2);
    expect(presented.context.widgetUiScale).toBeCloseTo(1.2);
    expect(presented.widgetViewportScale).toBe(1);
    expect(scaleScreenMetric(20, presented.context)).toBe(24);
    expect(scalePresentedFontPx(20, presented.context.widgetUiScale)).toBe(24);
    expect(scaleScreenMetric(20, presented.context)).not.toBe(19);
    expect(scaleScreenMetric(20, presented.context)).not.toBe(29);
    expect(resolveCanvasContentScale(presented.context)).toBe(1);
  });

  it('keeps the transform-path ui scale when layout stays on the design canvas', () => {
    const presented = presentScreenRenderContext({
      layoutMode: 'designTransform',
      fitScale: visual.fitScale,
      scaleX: visual.scaleX,
      scaleY: visual.scaleY,
      screenDensity: visual.screenDensity,
      transformUiScale: visual.screenUiScale,
    });

    expect(presented.context.layoutMode).toBe('designTransform');
    expect(presented.context.widgetUiScale).toBeCloseTo(visual.screenUiScale);
    expect(presented.widgetViewportScale).toBeCloseTo(visual.fitScale);
    expect(resolveCanvasContentScale(presented.context)).toBeCloseTo(1.2);
  });
});

describe('mapDesignBoxToViewportPixels', () => {
  it('maps each axis independently and does not mutate the design box', () => {
    const design = { x: 10, y: 10, w: 30, h: 20 };
    const mapped = mapDesignBoxToViewportPixels(design, 1, 1200 / 1080);

    expect(mapped).toEqual({ x: 10, y: 11, w: 30, h: 22 });
    expect(design).toEqual({ x: 10, y: 10, w: 30, h: 20 });
  });

  it('keeps a zero-width design box at least one pixel', () => {
    expect(mapDesignBoxToViewportPixels({ x: 0, y: 0, w: 0, h: 0 }, 2, 2)).toEqual({
      x: 0,
      y: 0,
      w: 1,
      h: 1,
    });
  });
});
