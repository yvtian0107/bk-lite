import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveTableBodyScrollY } from '../src/app/ops-analysis/components/widgets/shared/useTableBodyScrollY';
import { resolveTableDimensions } from '../src/components/custom-table/tableHeight';

const runtimeTableSource = readFileSync(
  new URL('../src/app/ops-analysis/components/widgets/comTable.tsx', import.meta.url),
  'utf8',
);
const showcaseTableSource = readFileSync(
  new URL('../src/app/ops-analysis/components/ops-analysis-widgets/table.tsx', import.meta.url),
  'utf8',
);
const runtimeEventSource = readFileSync(
  new URL('../src/app/ops-analysis/components/widgets/eventTable/eventTable.tsx', import.meta.url),
  'utf8',
);
const showcaseEventSource = readFileSync(
  new URL('../src/app/ops-analysis/components/ops-analysis-widgets/event-table.tsx', import.meta.url),
  'utf8',
);
const scrollHookSource = readFileSync(
  new URL(
    '../src/app/ops-analysis/components/widgets/shared/useTableBodyScrollY.ts',
    import.meta.url,
  ),
  'utf8',
);
const dashboardCanvasSource = readFileSync(
  new URL(
    '../src/app/ops-analysis/(pages)/view/dashBoard/components/dashboardCanvas.tsx',
    import.meta.url,
  ),
  'utf8',
);

for (const [name, source] of [
  ['运行时表格', runtimeTableSource],
  ['组件展示表格', showcaseTableSource],
  ['运行时事件表', runtimeEventSource],
  ['组件展示事件表', showcaseEventSource],
] as const) {
  assert.match(source, /useTableBodyScrollY\(/, `${name}要用槽位量到的表体高度`);
  assert.match(source, /y:\s*tableScrollY/, `${name}要把数字高度交给 CustomTable`);
  assert.doesNotMatch(
    source,
    /y:\s*tableScrollY\s*\*/,
    `${name}不能再把表体高度乘一次缩放`,
  );
  assert.doesNotMatch(
    source,
    /scroll=\{\{\s*x:\s*'max-content'\s*\}\}/,
    `${name}不能只声明横向滚动`,
  );
}

const scrollHookCode = scrollHookSource
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');
assert.doesNotMatch(
  scrollHookCode,
  /widgetUiScale|widgetScale/,
  '测高钩子不能读取或再乘 widgetUiScale',
);
assert.equal(
  resolveTableBodyScrollY({ containerHeight: 320, hasPagination: false }),
  273,
  '无分页表格应使用 widget 剩余高度减去表头高度',
);
assert.equal(
  resolveTableBodyScrollY({ containerHeight: 320, hasPagination: true }),
  217,
  '有分页表格还应为分页栏预留高度',
);
assert.equal(
  resolveTableBodyScrollY({ containerHeight: 226, hasPagination: true }),
  123,
  '矮容器不能把表体抬到 160，否则锁定高度会超过父级',
);
assert.equal(
  resolveTableDimensions({
    scrollY: 100,
    viewportHeight: 900,
    parentHeight: 180,
    size: 'small',
    hasPagination: false,
  }).tableHeight,
  100,
  '数字 scroll.y 保持调用方量到的高度',
);
assert.equal(
  resolveTableDimensions({
    scrollY: undefined,
    viewportHeight: 900,
    parentHeight: 400,
    size: 'small',
    hasPagination: false,
  }).containerHeight,
  undefined,
  '省略 y 的无分页表格仍按内容撑高',
);
assert.match(
  dashboardCanvasSource,
  /className="widget-body flex-1 h-full min-h-0"/,
  'widget 内容区必须允许表格在 flex 布局中收缩',
);

console.log('ops analysis table height contract tests passed');
