import { z } from 'zod';
import { id, coords } from './common';
import { bkBindingSchema } from './bkBinding';

export const rectangleSchema = z.object({
  id,
  color: id.optional(),
  from: coords,
  to: coords,
  bkBinding: bkBindingSchema.optional(),
  bkFollowAlert: z.boolean().optional()
});
