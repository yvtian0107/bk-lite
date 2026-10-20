export const ICON_HIT_SELECTOR = '[data-icon-hit]';

export interface IconHitRect {
  id: string;
  order: number;
  index: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface IconHitElement {
  getAttribute(name: string): string | null;
  getBoundingClientRect(): {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
}

export interface IconHitRoot {
  querySelectorAll(selector: string): ArrayLike<IconHitElement>;
}

const finiteOr = (value: number, fallback: number) => {
  return Number.isFinite(value) ? value : fallback;
};

export const readIconHitRects = (root: IconHitRoot): IconHitRect[] => {
  const nodes = Array.from(root.querySelectorAll(ICON_HIT_SELECTOR));
  const rects: IconHitRect[] = [];

  nodes.forEach((node, index) => {
    const id = node.getAttribute('data-icon-hit')?.trim() ?? '';

    if (!id) return;

    const box = node.getBoundingClientRect();
    const width = box.right - box.left;
    const height = box.bottom - box.top;

    if (width <= 0 || height <= 0) return;

    const pad = Math.max(0, finiteOr(Number(node.getAttribute('data-icon-pad')), 0));

    rects.push({
      id,
      order: finiteOr(Number(node.getAttribute('data-icon-order')), 0),
      index,
      left: box.left - pad,
      top: box.top - pad,
      right: box.right + pad,
      bottom: box.bottom + pad
    });
  });

  return rects;
};

const containsPoint = (rect: IconHitRect, point: { x: number; y: number }) => {
  return (
    point.x >= rect.left &&
    point.x <= rect.right &&
    point.y >= rect.top &&
    point.y <= rect.bottom
  );
};

const isAbove = (candidate: IconHitRect, current: IconHitRect) => {
  return (
    candidate.order > current.order ||
    (candidate.order === current.order && candidate.index > current.index)
  );
};

export const findIconHit = (
  point: { x: number; y: number },
  rects: IconHitRect[]
): string | null => {
  let best: IconHitRect | null = null;

  for (const rect of rects) {
    if (!containsPoint(rect, point)) continue;

    if (!best || isAbove(rect, best)) best = rect;
  }

  return best ? best.id : null;
};

export const findDrawnIconId = (
  root: IconHitRoot | null | undefined,
  point: { x: number; y: number }
): string | null => {
  if (!root) return null;

  return findIconHit(point, readIconHitRects(root));
};

export type ViewClickItem = {
  type: 'ITEM' | 'RECTANGLE' | 'CONNECTOR';
  id: string;
};

export type ViewClickDecision =
  | { kind: 'ignore' }
  | { kind: 'click'; item: ViewClickItem | null };

export const resolveViewClick = (input: {
  iconId: string | null;
  tileHit: { type: string; id: string } | null;
}): ViewClickDecision => {
  if (input.iconId) {
    return { kind: 'click', item: { type: 'ITEM', id: input.iconId } };
  }

  const hit = input.tileHit;

  if (!hit) return { kind: 'click', item: null };

  if (hit.type === 'TEXTBOX') return { kind: 'ignore' };

  if (
    hit.type === 'ITEM' ||
    hit.type === 'RECTANGLE' ||
    hit.type === 'CONNECTOR'
  ) {
    return { kind: 'click', item: { type: hit.type, id: hit.id } };
  }

  return { kind: 'ignore' };
};

export const viewHoverCursor = (input: {
  iconId: string | null;
  tileHit: { type: string; id: string } | null;
  rectangleInteractive?: boolean;
}): 'pointer' | 'grab' => {
  if (input.iconId) return 'pointer';

  const hit = input.tileHit;

  if (hit?.type === 'RECTANGLE') {
    return input.rectangleInteractive ? 'pointer' : 'grab';
  }

  if (hit && (hit.type === 'ITEM' || hit.type === 'CONNECTOR')) {
    return 'pointer';
  }

  return 'grab';
};
