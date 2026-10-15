import { z } from "zod"

import { SLUG } from "./slug"

export const slugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(SLUG, "Use lowercase letters, numbers and hyphens only.")
