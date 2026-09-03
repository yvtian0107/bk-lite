import { describe, expect, it } from 'vitest';
import { UNKNOWN_STATUS_BADGE } from '../application3DLayout';
import {
  ARCH_HOST_OVERLAY_GAP,
  ARCH_HOST_OVERLAY_SIZE,
  formatArchitectureHostAlarmCount,
  formatArchitectureHostSeverity,
  formatArchitectureHostState,
  overlayScreenRect,
  placeOverlayOutsideRect,
  screenRectsIntersect,
  type ScreenRect,
} from '../application3DArchitectureOverlay';

const viewport = { width: 320, height: 180 };
const overlay = ARCH_HOST_OVERLAY_SIZE;

const hostAt = (left: number, top: number, width = 40, height = 60): ScreenRect => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});

describe('placeOverlayOutsideRect', () => {
  it('prefers the right side when that leftover space is largest', () => {
    const host = hostAt(20, 60);
    const placed = placeOverlayOutsideRect(host, overlay, viewport, ARCH_HOST_OVERLAY_GAP);
    expect(placed.side).toBe('right');
    expect(placed.left).toBeCloseTo(host.right + ARCH_HOST_OVERLAY_GAP);
    expect(
      screenRectsIntersect(overlayScreenRect(placed, overlay), host),
    ).toBe(false);
  });

  it('prefers the left side when the host sits on the right', () => {
    const host = hostAt(260, 60);
    const placed = placeOverlayOutsideRect(host, overlay, viewport, ARCH_HOST_OVERLAY_GAP);
    expect(placed.side).toBe('left');
    expect(placed.left + overlay.width).toBeCloseTo(host.left - ARCH_HOST_OVERLAY_GAP);
    expect(
      screenRectsIntersect(overlayScreenRect(placed, overlay), host),
    ).toBe(false);
  });

  it('prefers above when leftover vertical space is larger than the sides', () => {
    const host = hostAt(90, 140, 140, 28);
    const placed = placeOverlayOutsideRect(host, overlay, viewport, ARCH_HOST_OVERLAY_GAP);
    expect(placed.side).toBe('above');
    expect(placed.top + overlay.height).toBeCloseTo(host.top - ARCH_HOST_OVERLAY_GAP);
    expect(
      screenRectsIntersect(overlayScreenRect(placed, overlay), host),
    ).toBe(false);
  });

  it('prefers below when the host sits at the top', () => {
    const host = hostAt(120, 8, 80, 40);
    const placed = placeOverlayOutsideRect(host, overlay, viewport, ARCH_HOST_OVERLAY_GAP);
    expect(placed.side).toBe('below');
    expect(placed.top).toBeCloseTo(host.bottom + ARCH_HOST_OVERLAY_GAP);
    expect(
      screenRectsIntersect(overlayScreenRect(placed, overlay), host),
    ).toBe(false);
  });

  it('breaks leftover ties in right → left → above → below order', () => {
    const host = hostAt(140, 60, 40, 60);
    const placed = placeOverlayOutsideRect(host, overlay, viewport, ARCH_HOST_OVERLAY_GAP);
    expect(placed.side).toBe('right');
    expect(
      screenRectsIntersect(overlayScreenRect(placed, overlay), host),
    ).toBe(false);
  });

  it('clamps to the canvas without covering the host', () => {
    const host = hostAt(8, 4, 36, 40);
    const placed = placeOverlayOutsideRect(host, overlay, viewport, ARCH_HOST_OVERLAY_GAP);
    expect(placed.left).toBeGreaterThanOrEqual(0);
    expect(placed.top).toBeGreaterThanOrEqual(0);
    expect(placed.left + overlay.width).toBeLessThanOrEqual(viewport.width);
    expect(placed.top + overlay.height).toBeLessThanOrEqual(viewport.height);
    expect(
      screenRectsIntersect(overlayScreenRect(placed, overlay), host),
    ).toBe(false);
  });

  it('keeps an 8–12px gap on the chosen side when space allows', () => {
    const host = hostAt(24, 50);
    const placed = placeOverlayOutsideRect(host, overlay, viewport);
    expect(ARCH_HOST_OVERLAY_GAP).toBeGreaterThanOrEqual(8);
    expect(ARCH_HOST_OVERLAY_GAP).toBeLessThanOrEqual(12);
    expect(placed.left - host.right).toBe(ARCH_HOST_OVERLAY_GAP);
  });
});

describe('architecture host overlay copy', () => {
  const t = (_id: string, fallback = '') => fallback;

  it('reuses application3D status labels for health.state', () => {
    expect(formatArchitectureHostState('normal', t)).toBe('运行正常');
    expect(formatArchitectureHostState('alarming', t)).toBe('告警');
    expect(formatArchitectureHostState('unknown', t)).toBe('状态未知');
  });

  it('shows the wall unknown glyph when count or severity is missing', () => {
    expect(formatArchitectureHostAlarmCount(null)).toBe(UNKNOWN_STATUS_BADGE);
    expect(formatArchitectureHostAlarmCount(4)).toBe('4');
    expect(formatArchitectureHostSeverity(null)).toBe(UNKNOWN_STATUS_BADGE);
    expect(formatArchitectureHostSeverity('严重')).toBe('严重');
  });
});
