import { z } from 'zod';
import { id, coords } from './common';

export const rectangleSchema = z.object({
  id,
  color: id.optional(),
  from: coords,
  to: coords,
  bkBinding: z.unknown().optional(),
  bkFollowAlert: z.boolean().optional()
});
