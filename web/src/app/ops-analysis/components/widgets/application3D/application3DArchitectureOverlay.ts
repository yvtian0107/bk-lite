import * as THREE from 'three';
import type { Application3DArchitectureNode } from '@/app/ops-analysis/types/sceneWidget';
import {
  UNKNOWN_STATUS_BADGE,
  type Application3DTranslate,
} from './application3DLayout';

export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ScreenSize {
  width: number;
  height: number;
}

export type ArchitectureOverlaySide = 'right' | 'left' | 'above' | 'below';

export interface ArchitectureHostSelection {
  node: Application3DArchitectureNode;
  hostScreenRect: ScreenRect;
  overlay: { left: number; top: number };
}

/** Keep in sync with `.app3d-arch-host-chip` in application3DChrome.css. */
export const ARCH_HOST_OVERLAY_SIZE = { width: 176, height: 96 } as const;
export const ARCH_HOST_OVERLAY_GAP = 10;

const SIDES: ArchitectureOverlaySide[] = ['right', 'left', 'above', 'below'];

export const screenRectsIntersect = (a: ScreenRect, b: ScreenRect) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

export const overlayScreenRect = (
  position: { left: number; top: number },
  size: ScreenSize = ARCH_HOST_OVERLAY_SIZE,
): ScreenRect => ({
  left: position.left,
  top: position.top,
  right: position.left + size.width,
  bottom: position.top + size.height,
});

const leftoverOnSide = (
  side: ArchitectureOverlaySide,
  host: ScreenRect,
  viewport: ScreenSize,
) => {
  if (side === 'right') return viewport.width - host.right;
  if (side === 'left') return host.left;
  if (side === 'above') return host.top;
  return viewport.height - host.bottom;
};

const rankSides = (host: ScreenRect, viewport: ScreenSize) =>
  [...SIDES].sort((a, b) => {
    const delta = leftoverOnSide(b, host, viewport) - leftoverOnSide(a, host, viewport);
    if (delta !== 0) return delta;
    return SIDES.indexOf(a) - SIDES.indexOf(b);
  });

const placeOnSide = (
  side: ArchitectureOverlaySide,
  host: ScreenRect,
  overlay: ScreenSize,
  gap: number,
) => {
  const midX = (host.left + host.right) / 2;
  const midY = (host.top + host.bottom) / 2;
  if (side === 'right') {
    return { left: host.right + gap, top: midY - overlay.height / 2 };
  }
  if (side === 'left') {
    return { left: host.left - gap - overlay.width, top: midY - overlay.height / 2 };
  }
  if (side === 'above') {
    return { left: midX - overlay.width / 2, top: host.top - gap - overlay.height };
  }
  return { left: midX - overlay.width / 2, top: host.bottom + gap };
};

const clampOverlay = (
  position: { left: number; top: number },
  overlay: ScreenSize,
  viewport: ScreenSize,
) => ({
  left: Math.min(Math.max(position.left, 0), Math.max(0, viewport.width - overlay.width)),
  top: Math.min(Math.max(position.top, 0), Math.max(0, viewport.height - overlay.height)),
});

/**
 * Place a compact overlay outside the host screen AABB.
 * Prefers the side with more leftover viewport space: right, left, above, below.
 * Result is clamped to the canvas and must not cover the host when there is room.
 */
export const placeOverlayOutsideRect = (
  host: ScreenRect,
  overlay: ScreenSize = ARCH_HOST_OVERLAY_SIZE,
  viewport: ScreenSize,
  gap = ARCH_HOST_OVERLAY_GAP,
): { left: number; top: number; side: ArchitectureOverlaySide } => {
  const sides = rankSides(host, viewport);
  for (const side of sides) {
    const clamped = clampOverlay(placeOnSide(side, host, overlay, gap), overlay, viewport);
    if (!screenRectsIntersect(overlayScreenRect(clamped, overlay), host)) {
      return { ...clamped, side };
    }
    const raw = placeOnSide(side, host, overlay, gap);
    if (!screenRectsIntersect(overlayScreenRect(raw, overlay), host)) {
      return { ...raw, side };
    }
  }
  const fallback = sides[0];
  const clamped = clampOverlay(placeOnSide(fallback, host, overlay, gap), overlay, viewport);
  return { ...clamped, side: fallback };
};

export const projectWorldBoxToScreenRect = (
  box: THREE.Box3,
  camera: THREE.Camera,
  viewport: ScreenSize,
): ScreenRect => {
  const point = new THREE.Vector3();
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        point.set(x, y, z).project(camera);
        const sx = (point.x * 0.5 + 0.5) * viewport.width;
        const sy = (-point.y * 0.5 + 0.5) * viewport.height;
        left = Math.min(left, sx);
        right = Math.max(right, sx);
        top = Math.min(top, sy);
        bottom = Math.max(bottom, sy);
      }
    }
  }
  return { left, top, right, bottom };
};

export const formatArchitectureHostState = (
  state: string | undefined,
  t: Application3DTranslate,
) => {
  if (state === 'normal') return t('dashboard.application3DStatus_normal', '运行正常');
  if (state === 'alarming') return t('dashboard.application3DStatus_alarming', '告警');
  return t('dashboard.application3DStatus_unknown', '状态未知');
};

export const formatArchitectureHostAlarmCount = (count: number | null | undefined) =>
  count == null ? UNKNOWN_STATUS_BADGE : String(count);

export const formatArchitectureHostSeverity = (label: string | null | undefined) =>
  label?.trim() ? label : UNKNOWN_STATUS_BADGE;
