import { z } from "zod";
import { SESSION_MODES } from "../core/types.js";

export const createSessionSchema = z.object({
  fixtureId: z.string().min(1),
  mode: z.enum(SESSION_MODES),
  visibilityCursor: z.number().finite().nonnegative().optional(),
  delayMs: z.number().finite().nonnegative().optional()
});

export const sessionCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ADVANCE_TO"),
    cursorMs: z.number().finite().nonnegative()
  }),
  z.object({ type: z.literal("PAUSE") }),
  z.object({ type: z.literal("RESUME") }),
  z.object({ type: z.literal("CATCH_UP") }),
  z.object({
    type: z.literal("SET_DELAY"),
    delayMs: z.number().finite().nonnegative()
  }),
  z.object({
    type: z.literal("START_REPLAY"),
    cursorMs: z.number().finite().nonnegative()
  })
]);
