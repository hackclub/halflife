import { z } from "zod"
import { Phase } from "@/app/generated/prisma/enums"

export const cuid = z.string().min(1).max(64)

export const phaseSchema = z.enum(Phase)

/** Rejects javascript:, data: and friends — a URL field is not a script host. */
export const httpsUrl = z
  .string()
  .trim()
  .max(1000)
  .refine((v) => {
    try {
      const parsed = new URL(v)
      return parsed.protocol === "https:" || parsed.protocol === "http:"
    } catch {
      return false
    }
  }, "Must be an http(s) URL")

export function boundedText(max: number, min = 0) {
  return z.string().trim().min(min).max(max)
}

export const reasonText = boundedText(2000, 1)
