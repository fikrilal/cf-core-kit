import { z } from "zod";

export const cursorPaginationMetaSchema = z
  .object({
    limit: z.number().meta({ example: 25 }),
    hasMore: z.boolean().meta({ example: true }),
    nextCursor: z.string().optional().meta({
      example: "eyJ2IjoxLCJzb3J0IjoiLWNyZWF0ZWRBdCIsImFmdGVyIjp7fX0",
    }),
  })
  .meta({ id: "CursorPaginationMetaDto" });
