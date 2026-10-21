import type { ScreenRenderContext } from '@/app/ops-analysis/types/dashBoard';

export const INTERACTION_MENU_SCALE_MIN = 1;
export const INTERACTION_MENU_SCALE_MAX = 1.6;

const positive = (value: number | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;

const sameScale = (left: number, right: number) => Math.abs(left - right) <= 0.001;

type MenuScaleInput = Pick<
  ScreenRenderContext,
  'enabled' | 'fitScale' | 'scaleX' | 'scaleY' | 'widgetUiScale' | 'screenUiScale'
>;

/**
 * 大屏把组件画在 `scale(scaleX, scaleY)` 里。查看和编辑用 contain，
 * 两轴相等，并且等于 fitScale，这就是组件实际被放大的倍数。
 * 全屏铺满把两轴拉开时菜单不能跟着 transform 拉伸，改用 fitScale。
 * 再乘组件框自己的 ui-scale，并限制在 [1, 1.6]。
 */
export const resolveInteractionMenuScale = (
  context?: MenuScaleInput | null,
): number => {
  if (!context?.enabled) return INTERACTION_MENU_SCALE_MIN;
  const scaleX = positive(context.scaleX);
  const scaleY = positive(context.scaleY);
  const uniformAxis = scaleX != null && scaleY != null && sameScale(scaleX, scaleY)
    ? scaleX
    : undefined;
  const canvasScale = uniformAxis
    ?? positive(context.fitScale)
    ?? (scaleX != null && scaleY != null ? Math.min(scaleX, scaleY) : undefined)
    ?? INTERACTION_MENU_SCALE_MIN;
  const uiScale = positive(context.widgetUiScale)
    ?? positive(context.screenUiScale)
    ?? INTERACTION_MENU_SCALE_MIN;
  const raw = canvasScale * uiScale;
  const clamped = Math.min(
    INTERACTION_MENU_SCALE_MAX,
    Math.max(INTERACTION_MENU_SCALE_MIN, raw),
  );
  return Math.round(clamped * 1000) / 1000;
};
