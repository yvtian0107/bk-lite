import React from 'react';
import { Box } from '@mui/material';
import { useScene } from 'src/hooks/useScene';
import { useDiagramVisual } from 'src/diagramOverlay/context';
import { RECTANGLE_BORDER_COLOR } from 'src/diagramOverlay/colors';
import { getRectangleFrontVertex } from 'src/diagramOverlay/rectangleAnchor';

const Bell = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
    <path
      d="M8 1.7a3.8 3.8 0 0 0-3.8 3.8v2.1L2.8 10.2h10.4L11.8 7.6V5.5A3.8 3.8 0 0 0 8 1.7z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
    <path
      d="M6.7 11.3a1.3 1.3 0 0 0 2.6 0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  </svg>
);

export const RectangleStatusLayer = () => {
  const { rectangles } = useScene();
  const { rectangleStatus, setHoveredRectangleId } = useDiagramVisual();

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

        // Front vertex is the screen-bottom tip of the drawn diamond. The tab
        // hangs from that point, centered, and is not shifted when covered.
        const vertex = getRectangleFrontVertex(rectangle.from, rectangle.to);
        const accent = status.borderLevel
          ? RECTANGLE_BORDER_COLOR[status.borderLevel]
          : '#6b7280';
        const interactive = Boolean(badgeText);

        return (
          <Box
            key={rectangle.id}
            data-rectangle-id={rectangle.id}
            data-rectangle-anchor="front"
            data-anchor-x={vertex.x}
            data-anchor-y={vertex.y}
            data-rectangle-label={label ?? ''}
            data-rectangle-badge={badgeText ?? ''}
            data-rectangle-summary={summaryText ?? ''}
            onMouseEnter={
              interactive ? () => setHoveredRectangleId(rectangle.id) : undefined
            }
            onMouseLeave={
              interactive ? () => setHoveredRectangleId(null) : undefined
            }
            style={{
              left: vertex.x,
              top: vertex.y
            }}
            sx={{
              position: 'absolute',
              transform: 'translate(-50%, 0)',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              pointerEvents: interactive ? 'auto' : 'none',
              userSelect: 'none',
              px: '8px',
              py: '3px',
              borderRadius: '0 0 8px 8px',
              border: `2px solid ${accent}`,
              borderTop: 'none',
              bgcolor: '#fff',
              color: accent,
              boxShadow: '0 1px 2px rgba(15, 23, 42, 0.12)',
              fontFamily:
                '"WenQuanYi Micro Hei", "Noto Sans CJK SC", "Noto Sans SC", sans-serif',
              zIndex: 2
            }}
          >
            {badgeText ? <Bell /> : null}
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
                  color: '#111827',
                  fontSize: 12,
                  fontWeight: 600,
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
