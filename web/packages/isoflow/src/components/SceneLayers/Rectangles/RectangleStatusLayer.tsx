import React from 'react';
import { Box } from '@mui/material';
import { useScene } from 'src/hooks/useScene';
import { useDiagramVisual } from 'src/diagramOverlay/context';
import { RECTANGLE_BORDER_COLOR } from 'src/diagramOverlay/colors';
import { getRectangleFrontVertex } from 'src/diagramOverlay/rectangleAnchor';

const TAB_GAP_PX = 6;

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
        const badgeText = status.badgeText?.trim() ? status.badgeText : undefined;
        const summaryText = status.summaryText?.trim() ? status.summaryText : undefined;

        if (!label && !badgeText && !summaryText) return null;

        const vertex = getRectangleFrontVertex(rectangle.from, rectangle.to);
        const accent = status.borderLevel
          ? RECTANGLE_BORDER_COLOR[status.borderLevel]
          : '#6b7280';

        return (
          <Box
            key={rectangle.id}
            data-rectangle-id={rectangle.id}
            data-rectangle-anchor="front"
            data-rectangle-label={label ?? ''}
            data-rectangle-badge={badgeText ?? ''}
            data-rectangle-summary={summaryText ?? ''}
            sx={{
              position: 'absolute',
              left: vertex.x,
              top: vertex.y + TAB_GAP_PX,
              transform: 'translate(-50%, 0)',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              pointerEvents: 'none',
              userSelect: 'none',
              px: '8px',
              py: '3px',
              borderRadius: '0 0 8px 8px',
              border: '1px solid #d1d5db',
              borderTop: 'none',
              bgcolor: '#fff',
              boxShadow: '0 1px 2px rgba(15, 23, 42, 0.16)',
              fontFamily:
                '"WenQuanYi Micro Hei", "Noto Sans CJK SC", "Noto Sans SC", sans-serif'
            }}
          >
            {label && (
              <Box
                sx={{
                  color: '#111827',
                  fontSize: 12,
                  fontWeight: 600,
                  lineHeight: 1.3,
                  whiteSpace: 'nowrap'
                }}
              >
                {label}
              </Box>
            )}
            {summaryText && (
              <Box
                sx={{
                  px: '5px',
                  borderRadius: '4px',
                  border: '1px solid #94a3b8',
                  color: '#475569',
                  fontSize: 11,
                  fontWeight: 600,
                  lineHeight: '16px',
                  whiteSpace: 'nowrap'
                }}
              >
                {summaryText}
              </Box>
            )}
            {badgeText && (
              <Box
                sx={{
                  px: '6px',
                  borderRadius: 999,
                  border: `1px solid ${accent}`,
                  bgcolor: '#fff',
                  color: accent,
                  fontSize: 11,
                  fontWeight: 700,
                  lineHeight: '16px',
                  whiteSpace: 'nowrap'
                }}
              >
                {badgeText}
              </Box>
            )}
          </Box>
        );
      })}
    </>
  );
};
