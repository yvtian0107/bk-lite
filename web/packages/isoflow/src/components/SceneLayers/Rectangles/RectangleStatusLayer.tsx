import React from 'react';
import { Box } from '@mui/material';
import { useScene } from 'src/hooks/useScene';
import { useDiagramVisual } from 'src/diagramOverlay/context';
import { CRITICAL_RED, RECTANGLE_BORDER_COLOR } from 'src/diagramOverlay/colors';
import { getRectangleLeftVertex } from 'src/diagramOverlay/rectangleAnchor';
import type { RectangleStatusBadgePart } from 'src/types';

const BADGE_PART_COLOR: Record<RectangleStatusBadgePart['level'], string> = {
  critical: CRITICAL_RED,
  // Darker than WARNING_AMBER so the text stays readable on the white plate.
  warning: '#d97706'
};

const PLATE_LIFT = 28;

export const RectangleStatusLayer = () => {
  const { rectangles } = useScene();
  const { rectangleStatus, setHoveredRectangleId } = useDiagramVisual();

  if (!rectangleStatus) return null;

  return (
    <>
      {rectangles.map((rectangle) => {
        const status = rectangleStatus[rectangle.id];
        const badgeParts = (status?.badgeParts ?? []).filter(
          (part): part is RectangleStatusBadgePart =>
            (part.level === 'critical' || part.level === 'warning') && Boolean(part.text?.trim())
        );
        const badgeText = status?.badgeText?.trim() || '';

        if (!badgeParts.length && !badgeText) return null;

        const badgeHint = status?.badgeHint?.trim() ? status.badgeHint : undefined;
        const vertex = getRectangleLeftVertex(rectangle.from, rectangle.to);
        const accent = status?.borderLevel
          ? RECTANGLE_BORDER_COLOR[status.borderLevel]
          : '#6b7280';
        const badgeLabel = badgeText || badgeParts.map((part) => part.text).join(' ');

        return (
          <Box
            key={rectangle.id}
            data-rectangle-id={rectangle.id}
            data-rectangle-anchor="left"
            data-anchor-x={vertex.x}
            data-anchor-y={vertex.y}
            data-rectangle-badge={badgeLabel}
            style={{
              left: vertex.x,
              top: vertex.y
            }}
            sx={{
              position: 'absolute',
              transform: `translate(0, calc(-100% - ${PLATE_LIFT}px))`,
              pointerEvents: 'none',
              zIndex: 2
            }}
          >
            <Box
              title={badgeHint}
              data-rectangle-badge-hit={rectangle.id}
              onMouseEnter={() => setHoveredRectangleId(rectangle.id)}
              onMouseLeave={() => setHoveredRectangleId(null)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                boxSizing: 'border-box',
                height: 22,
                maxWidth: 200,
                pl: '6px',
                pr: '8px',
                gap: '10px',
                overflow: 'hidden',
                pointerEvents: 'auto',
                cursor: 'pointer',
                userSelect: 'none',
                borderRadius: '4px',
                border: `1px solid ${accent}`,
                borderLeft: `3px solid ${accent}`,
                bgcolor: '#fff',
                boxShadow: 'none',
                fontFamily:
                  '"WenQuanYi Micro Hei", "Noto Sans CJK SC", "Noto Sans SC", sans-serif',
                fontSize: 12,
                fontWeight: 600,
                lineHeight: '20px',
                fontVariantNumeric: 'tabular-nums',
                whiteSpace: 'nowrap'
              }}
            >
              {badgeParts.length
                ? badgeParts.map((part) => (
                    <Box
                      key={part.level}
                      component="span"
                      data-rectangle-badge-part={part.level}
                      sx={{ color: BADGE_PART_COLOR[part.level], flexShrink: 0 }}
                    >
                      {part.text}
                    </Box>
                  ))
                : (
                    <Box
                      component="span"
                      sx={{
                        minWidth: 0,
                        overflow: 'hidden',
                        color: '#111827',
                        textOverflow: 'ellipsis'
                      }}
                    >
                      {badgeText}
                    </Box>
                  )}
            </Box>
            <Box
              aria-hidden
              data-rectangle-stem=""
              sx={{
                position: 'absolute',
                left: '1px',
                top: '100%',
                width: '1px',
                height: PLATE_LIFT,
                bgcolor: accent,
                pointerEvents: 'none'
              }}
            />
          </Box>
        );
      })}
    </>
  );
};
