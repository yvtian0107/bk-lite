import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

import { DASHBOARD_GRID_COLS } from '@/app/ops-analysis/utils/dashboardGridColumns';

const require = createRequire(import.meta.url);
const dashboardCanvasSource = readFileSync(
  fileURLToPath(new URL('../dashboardCanvas.tsx', import.meta.url)),
  'utf8',
);

interface SavedNode {
  id?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

interface GridStackLike {
  init: (
    options: Record<string, unknown>,
    element: HTMLElement,
  ) => {
    getColumn: () => number;
    makeWidget: (element: HTMLElement, options: SavedNode) => void;
    save: (saveContent: boolean) => SavedNode[];
    destroy: (removeDom: boolean) => void;
  };
}

const loadGridStack = () =>
  require('gridstack/dist/gridstack-all.js') as GridStackLike;

const migratedRow: SavedNode[] = [
  { id: 'a', x: 0, y: 0, w: 6, h: 3 },
  { id: 'b', x: 6, y: 0, w: 6, h: 3 },
  { id: 'c', x: 12, y: 0, w: 6, h: 3 },
  { id: 'd', x: 18, y: 0, w: 6, h: 3 },
];

const installDom = () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    pretendToBeVisual: true,
    url: 'http://localhost',
  });
  const previous = {
    window: globalThis.window,
    self: globalThis.self,
    document: globalThis.document,
    HTMLElement: globalThis.HTMLElement,
    Element: globalThis.Element,
    Node: globalThis.Node,
    MutationObserver: globalThis.MutationObserver,
    getComputedStyle: globalThis.getComputedStyle,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    CustomEvent: globalThis.CustomEvent,
  };
  const { window } = dom;
  globalThis.window = window as unknown as Window & typeof globalThis;
  globalThis.self = window as unknown as typeof globalThis.self;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Element = window.Element;
  globalThis.Node = window.Node;
  globalThis.MutationObserver = window.MutationObserver;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(Date.now()), 0) as unknown as number;
  globalThis.CustomEvent = window.CustomEvent;
  return () => {
    Object.assign(globalThis, previous);
    dom.window.close();
  };
};

const placeRow = (column: number | 'auto') => {
  const GridStack = loadGridStack();
  const root = document.createElement('div');
  document.body.appendChild(root);
  const grid = GridStack.init(
    {
      column,
      cellHeight: 60,
      margin: 4,
      float: false,
      animate: false,
      disableDrag: true,
      disableResize: true,
    },
    root,
  );
  for (const card of migratedRow) {
    const item = document.createElement('div');
    item.className = 'grid-stack-item';
    const content = document.createElement('div');
    content.className = 'grid-stack-item-content';
    item.appendChild(content);
    root.appendChild(item);
    grid.makeWidget(item, { ...card });
  }
  const saved = grid
    .save(false)
    .map((node) => ({ id: node.id, x: node.x, y: node.y, w: node.w, h: node.h }));
  const columnCount = grid.getColumn();
  grid.destroy(false);
  root.remove();
  return { columnCount, saved };
};

test('分组子网格不能使用 auto 列', () => {
  assert.doesNotMatch(
    dashboardCanvasSource,
    /column:\s*'auto'/,
    '手动 GridStack.init 会丢掉 auto 并回落 12 列',
  );
  assert.match(
    dashboardCanvasSource,
    /const subGrid = GridStack\.init\(\s*\{[^}]*column:\s*DASHBOARD_GRID_COLS/s,
    '分组子网格必须与顶层一样使用 24 列',
  );
  assert.match(dashboardCanvasSource, /不能依赖 auto/);
});

test('12 列子网格会打乱已按 24 列写入的一行四卡，24 列保持原位', () => {
  const restore = installDom();
  try {
    const broken = placeRow('auto');
    assert.equal(broken.columnCount, 12);
    assert.notDeepEqual(
      broken.saved.map((node) => [node.id, node.x, node.y, node.w]),
      migratedRow.map((node) => [node.id, node.x, node.y, node.w]),
      'auto 回落后超出 12 列的子项会被重排',
    );

    const fixed = placeRow(DASHBOARD_GRID_COLS);
    assert.equal(fixed.columnCount, DASHBOARD_GRID_COLS);
    assert.deepEqual(
      fixed.saved.map((node) => [node.id, node.x, node.y, node.w, node.h]),
      migratedRow.map((node) => [node.id, node.x, node.y, node.w, node.h]),
    );
    const occupied = fixed.saved.map((node) => ({
      start: node.x ?? 0,
      end: (node.x ?? 0) + (node.w ?? 0),
      y: node.y,
    }));
    for (let index = 0; index < occupied.length; index += 1) {
      for (let other = index + 1; other < occupied.length; other += 1) {
        const left = occupied[index];
        const right = occupied[other];
        if (left.y !== right.y) {
          continue;
        }
        assert.ok(
          left.end <= right.start || right.end <= left.start,
          '同一行的卡片不能重叠',
        );
      }
    }
  } finally {
    restore();
  }
});
