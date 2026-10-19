import React from 'react';
import { Box } from '@mui/material';
import { PROJECTED_TILE_SIZE } from 'src/config';
import { useDiagramVisual } from 'src/diagramOverlay/context';
import { HIGHLIGHT_STROKE, NODE_STATUS_COLOR } from 'src/diagramOverlay/colors';
import type { NodeStatus, NodeStatusLevel } from 'src/types';

interface Props {
  nodeId: string;
}

const BADGE_TEXT: Partial<Record<NodeStatusLevel, string>> = {
  unknown: '?',
  invalid: '!'
};

const badgeLabel = (status: NodeStatus) => {
  if (status.level === 'warning' || status.level === 'critical') {
    if (typeof status.count === 'number' && Number.isFinite(status.count)) {
      return String(status.count);
    }

    return null;
  }

  return BADGE_TEXT[status.level] ?? null;
};

export const NodeStatusMark = ({ nodeId }: Props) => {
  const visual = useDiagramVisual();
  const status = visual.nodeStatus?.[nodeId];
  const highlighted =
    visual.editorMode === 'EXPLORABLE_READONLY' &&
    visual.highlightedItemId === nodeId;

  if (!status && !highlighted) return null;

  const width = PROJECTED_TILE_SIZE.width;
  const height = PROJECTED_TILE_SIZE.height;
  const color = status ? NODE_STATUS_COLOR[status.level] : undefined;
  const label = status ? badgeLabel(status) : null;
  const points = `${width / 2},0 ${width},${height / 2} ${width / 2},${height} 0,${height / 2}`;

  return (
    <Box
      aria-hidden
      data-node-status={status?.level ?? ''}
      data-node-highlight={highlighted ? 'true' : 'false'}
      sx={{
        position: 'absolute',
        left: -width / 2,
        top: -height,
        width,
        height,
        pointerEvents: 'none'
      }}
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ pointerEvents: 'none' }}
      >
        {highlighted && (
          <polygon
            points={points}
            fill="none"
            stroke={HIGHLIGHT_STROKE}
            strokeWidth={5}
            strokeLinejoin="round"
          />
        )}
        {status && (
          <polygon
            points={points}
            fill="none"
            stroke={color}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeDasharray={status.level === 'unknown' ? '5 4' : undefined}
          />
        )}
        {status?.level === 'forbidden' && (
          <line
            x1={width * 0.28}
            y1={height * 0.28}
            x2={width * 0.72}
            y2={height * 0.72}
            stroke={color}
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        )}
      </svg>
      {status?.level === 'forbidden' && (
        <Box
          sx={{
            position: 'absolute',
            left: width - 2,
            top: height / 2,
            width: 16,
            height: 16,
            transform: 'translate(0, -50%)',
            borderRadius: '50%',
            border: `2px solid ${color}`,
            bgcolor: '#fff',
            pointerEvents: 'none'
          }}
        >
          <Box
            sx={{
              position: 'absolute',
              left: 6,
              top: 1,
              width: 2,
              height: 12,
              bgcolor: color,
              transform: 'rotate(45deg)'
            }}
          />
        </Box>
      )}
      {label && (
        <Box
          sx={{
            position: 'absolute',
            left: width - 2,
            top: height / 2,
            minWidth: 16,
            height: 16,
            px: '4px',
            transform: 'translate(0, -50%)',
            borderRadius: 8,
            pointerEvents: 'none',
            bgcolor: color,
            color: status?.level === 'warning' ? '#1f2937' : '#fff',
            fontSize: 11,
            fontWeight: 700,
            lineHeight: '16px',
            textAlign: 'center',
            boxSizing: 'border-box'
          }}
        >
          {label}
        </Box>
      )}
    </Box>
  );
};
