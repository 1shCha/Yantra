import { z } from 'zod';

export const canvasSideSchema = z.enum(['top', 'right', 'bottom', 'left']);
export const canvasEndSchema = z.enum(['none', 'arrow']);

export type CanvasSide = z.infer<typeof canvasSideSchema>;
export type CanvasEnd = z.infer<typeof canvasEndSchema>;

export const canvasEdgeSchema = z.object({
  id: z.string(),
  fromNode: z.string(),
  toNode: z.string(),
  fromSide: canvasSideSchema.optional(),
  toSide: canvasSideSchema.optional(),
  fromEnd: canvasEndSchema.optional(),
  toEnd: canvasEndSchema.optional(),
  color: z.string().optional(),
  label: z.string().optional(),
});

export const canvasGroupSchema = z.object({
  id: z.string(),
  nodeIds: z.array(z.string()).min(2),
});

export type CanvasEdge = z.infer<typeof canvasEdgeSchema>;
export type CanvasGroup = z.infer<typeof canvasGroupSchema>;
