# 运营分析大屏：全屏铺满改为视口像素布局重算

Status: implemented

Supersedes (presentation only): `specs/changes/ops-analysis-screen-basic-layout/spec.md` 中「`fill` 用非等比 `scaleX/scaleY` 整层拉伸」的呈现约定。存盘模型、三种显示方式枚举、编辑 / PDF 强制 contain 不变。

## 行为

仅当 `resolveScreenDisplayAdapter` 解析为 `fill`，且是全屏或分享、且非 `forceContain`：

- 画布等于视口，外层 `transform` 为 `none`，不加 `screen-tech-canvas--stretched`。
- 组件呈现几何：`left = round(x * sx)`，`top = round(y * sy)`，`width = max(1, round(w * sx))`，`height = max(1, round(h * sy))`。不写回设计坐标。
- 字号密度 `fitScale = min(sx, sy)`。`ScreenRenderContext.layoutMode = 'viewportPixels'`，`widgetUiScale = fitScale`，图表视口倍数为 1。交互菜单的画布倍数视为 1，禁止再乘一层 `fitScale`。
- 编辑、非全屏查看、PDF（`forceContain`）、`fitWidth`、`fitHeight` 仍走设计尺寸盒子加等比 `transform`。

## 已知限制

- 布局仍按 `sx` / `sy` 拉开，非 16:9 窗口上构图会变。
- 装饰图和壁纸随盒子非等比变宽变高时，位图仍可能变形。
- 非正方形盒内的 CSS 圆可以变成椭圆；本期不做反向补偿。

## Completion evidence

- 闸门：`viewport.normalize.test.ts` 的 `shouldUseViewportPixelLayout`。
- 轴比例与字号不翻倍：`metrics.adapter.test.ts` 的 `viewport pixel font scale`。
- 菜单画布倍数：`interactionMenuScale.test.ts` 的 viewport pixel 用例。
- 画布无 `scale(sx, sy)`、几何抽样、编辑 / 查看 / PDF / fitWidth / fitHeight 仍走旧路径：`screenCanvas.rerender.test.tsx`。
- 机柜字号不再取 `1/fitScale`：`room3D/__tests__/readableScale.test.ts`。
- 标题/时钟密度：`screenChromeRenderer.clock.test.tsx`。
