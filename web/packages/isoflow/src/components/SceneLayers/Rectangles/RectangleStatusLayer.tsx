import React from 'react';
import { Box } from '@mui/material';
import { useScene } from 'src/hooks/useScene';
import { useDiagramVisual } from 'src/diagramOverlay/context';
import { RECTANGLE_BORDER_COLOR } from 'src/diagramOverlay/colors';
import { getRectangleTopVertex } from 'src/diagramOverlay/rectangleAnchor';

const LABEL_GAP_PX = 8;

export const RectangleStatusLayer = () => {
  const { rectangles } = useScene();
  const { rectangleStatus } = useDiagramVisual();

  if (!rectangleStatus) return null;

  return (
    <>
      {rectangles.map((rectangle) => {
        const status = rectangleStatus[rectangle.id];

        if (!status) return null;

        const label = status.label?.trim() ? status.label : undefined;
        const showBadge =
          typeof status.badgeCount === 'number' &&
          Number.isFinite(status.badgeCount) &&
          status.badgeCount > 0;

        if (!label && !showBadge) return null;

        const vertex = getRectangleTopVertex(rectangle.from, rectangle.to);
        const accent = status.borderLevel
          ? RECTANGLE_BORDER_COLOR[status.borderLevel]
          : '#6b7280';

        return (
          <Box
            key={rectangle.id}
            data-rectangle-id={rectangle.id}
            data-rectangle-label={label ?? ''}
            data-rectangle-badge={showBadge ? String(status.badgeCount) : ''}
            sx={{
              position: 'absolute',
              left: vertex.x,
              top: vertex.y - LABEL_GAP_PX,
              transform: 'translate(-50%, -100%)',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              pointerEvents: 'none',
              userSelect: 'none'
            }}
          >
            {label && (
              <Box
                sx={{
                  px: '8px',
                  py: '2px',
                  borderRadius: '4px',
                  border: `1px solid ${accent}`,
                  bgcolor: '#fff',
                  color: '#111827',
                  fontSize: 12,
                  fontWeight: 600,
                  lineHeight: 1.3,
                  whiteSpace: 'nowrap',
                  fontFamily:
                    '"WenQuanYi Micro Hei", "Noto Sans CJK SC", "Noto Sans SC", sans-serif',
                  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.18)'
                }}
              >
                {label}
              </Box>
            )}
            {showBadge && (
              <Box
                sx={{
                  minWidth: 18,
                  height: 18,
                  px: '5px',
                  borderRadius: 9,
                  bgcolor: accent,
                  color: status.borderLevel === 'warning' ? '#1f2937' : '#fff',
                  fontSize: 11,
                  fontWeight: 700,
                  lineHeight: '18px',
                  textAlign: 'center',
                  boxSizing: 'border-box'
                }}
              >
                {status.badgeCount}
              </Box>
            )}
          </Box>
        );
      })}
    </>
  );
};
