import { CANVAS_TYPE_REGISTRY, type CanvasType } from '@/app/ops-analysis/constants/canvasTypes';

export const canvasImportUpdatePath = (objectType: CanvasType, objectId: number): string => {
  const endpoint = CANVAS_TYPE_REGISTRY[objectType].endpoint;
  return `${endpoint}${objectId}/import-update/`;
};
