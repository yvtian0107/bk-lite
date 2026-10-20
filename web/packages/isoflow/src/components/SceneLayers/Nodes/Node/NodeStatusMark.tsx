import React from 'react';
import { Box } from '@mui/material';
import { PROJECTED_TILE_SIZE } from 'src/config';
import { useDiagramVisual } from 'src/diagramOverlay/context';
import { HIGHLIGHT_STROKE, NODE_STATUS_COLOR } from 'src/diagramOverlay/colors';
import type { NodeStatus, NodeStatusLevel } from 'src/types';

interface Props {
  nodeId: string;
  order: number;
}

// Highlight stroke is 5px. Expand the outline hit box by half of that so the
// stroke edge still counts as the icon.
const STATUS_OUTLINE_HIT_PAD = 3;
const MARK_SIZE = 16;
const CHAIN_COLOR = '#0891b2';

const COLORED_LEVEL = new Set<NodeStatusLevel>(['normal', 'warning', 'critical']);

const badgeLabel = (status: NodeStatus) => {
  if (status.level !== 'warning' && status.level !== 'critical') return null;
  if (typeof status.count !== 'number' || !Number.isFinite(status.count)) return null;

  return String(status.count);
};

const MarkDisc = ({
  nodeId,
  order,
  left,
  top,
  title,
  color,
  filled,
  plain,
  grow,
  children
}: {
  nodeId: string;
  order: number;
  left: number;
  top: number;
  title?: string;
  color: string;
  filled?: boolean;
  plain?: boolean;
  grow?: boolean;
  children: React.ReactNode;
}) => {
  return (
    <Box
      title={title || undefined}
      data-icon-hit={nodeId}
      data-icon-order={order}
      sx={{
        position: 'absolute',
        left,
        top,
        width: grow ? 'auto' : MARK_SIZE,
        minWidth: MARK_SIZE,
        height: MARK_SIZE,
        px: grow ? '4px' : 0,
        transform: 'translate(-50%, -50%)',
        borderRadius: 8,
        border: filled || plain ? 'none' : `1.5px solid ${color}`,
        bgcolor: filled ? color : plain ? 'transparent' : '#fff',
        color: filled ? (color === NODE_STATUS_COLOR.warning ? '#1f2937' : '#fff') : color,
        pointerEvents: title ? 'auto' : 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxSizing: 'border-box'
      }}
    >
      {children}
    </Box>
  );
};

const GrayGlyph = ({ level }: { level: NodeStatusLevel }) => {
  if (level === 'unknown') {
    return (
      <Box component="span" sx={{ fontSize: 11, fontWeight: 700, lineHeight: 1 }}>
        ?
      </Box>
    );
  }

  if (level === 'forbidden') {
    return (
      <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
        <rect
          x="3.5"
          y="7"
          width="9"
          height="6.5"
          rx="1.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <path
          d="M5.5 7V5.4a2.5 2.5 0 0 1 5 0V7"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        />
      </svg>
    );
  }

  if (level === 'invalid') {
    return (
      <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
        <path
          d="M2.5 6.2h3.2a1.7 1.7 0 0 1 0 3.4H2.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <path
          d="M13.5 6.2H10.3a1.7 1.7 0 0 0 0 3.4h3.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
      <circle
        cx="8"
        cy="8"
        r="4.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeDasharray="2 2"
      />
    </svg>
  );
};

const ChainGlyph = () => {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M6.1 9.4a2.1 2.1 0 0 1 0-3l.8-.8a2.1 2.1 0 0 1 3 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M9.9 6.6a2.1 2.1 0 0 1 0 3l-.8.8a2.1 2.1 0 0 1-3 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
};

export const NodeStatusMark = ({ nodeId, order }: Props) => {
  const visual = useDiagramVisual();
  const status = visual.nodeStatus?.[nodeId];
  const binding = visual.nodeBinding?.[nodeId];
  const highlighted =
    visual.editorMode === 'EXPLORABLE_READONLY' &&
    visual.highlightedItemId === nodeId;
  const showChain = Boolean(binding?.chain);
  const showUnbound = Boolean(binding?.unbound);

  if (!status && !highlighted && !showChain && !showUnbound) return null;

  const width = PROJECTED_TILE_SIZE.width;
  const height = PROJECTED_TILE_SIZE.height;
  const color = status ? NODE_STATUS_COLOR[status.level] : undefined;
  const label = status ? badgeLabel(status) : null;
  const coloredOutline = Boolean(status && color && COLORED_LEVEL.has(status.level));
  const grayMark = Boolean(
    status && !COLORED_LEVEL.has(status.level)
  );
  const points = `${width / 2},0 ${width},${height / 2} ${width / 2},${height} 0,${height / 2}`;
  const topRight = { left: width * 0.84, top: height * 0.2 };
  const bottomRight = { left: width * 0.84, top: height * 0.8 };

  return (
    <Box
      aria-hidden
      data-node-status={status?.level ?? ''}
      data-node-highlight={highlighted ? 'true' : 'false'}
      data-binding-chain={showChain ? 'true' : 'false'}
      data-binding-unbound={showUnbound ? 'true' : 'false'}
      data-icon-hit={nodeId}
      data-icon-order={order}
      data-icon-pad={STATUS_OUTLINE_HIT_PAD}
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
        {showUnbound && (
          <polygon
            points={points}
            fill="none"
            stroke="#9ca3af"
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeDasharray="5 4"
          />
        )}
        {coloredOutline && (
          <polygon
            points={points}
            fill="none"
            stroke={color}
            strokeWidth={2.5}
            strokeLinejoin="round"
          />
        )}
      </svg>
      {label && color ? (
        <MarkDisc
          nodeId={nodeId}
          order={order}
          left={topRight.left}
          top={topRight.top}
          title={status?.badgeHint}
          color={color}
          filled
          grow
        >
          <Box
            component="span"
            sx={{ fontSize: 11, fontWeight: 700, lineHeight: 1, px: '1px' }}
          >
            {label}
          </Box>
        </MarkDisc>
      ) : null}
      {grayMark && status && color ? (
        <MarkDisc
          nodeId={nodeId}
          order={order}
          left={bottomRight.left}
          top={bottomRight.top}
          title={status.hint}
          color={color}
          plain
        >
          <GrayGlyph level={status.level} />
        </MarkDisc>
      ) : null}
      {showChain ? (
        <MarkDisc
          nodeId={nodeId}
          order={order}
          left={bottomRight.left}
          top={bottomRight.top}
          color={CHAIN_COLOR}
        >
          <ChainGlyph />
        </MarkDisc>
      ) : null}
    </Box>
  );
};
