import type { NextRequest } from "next/server"
import { z } from "zod"
import { ok, parseQuery, withRoute } from "@/lib/api"
import { getThemeDef } from "@/lib/config/program"
import { requireExportAuth } from "@/lib/integration-auth"
import { cursorArgs, pageResult, paginationQuery } from "@/lib/pagination"
import prisma from "@/lib/prisma"

export const dynamic = "force-dynamic"

const query = paginationQuery.extend({ updatedSince: z.coerce.date().optional() })

/**
 * Read-only participant export for the YSWS pipeline and sibling programs.
 * Accepts a narrower per-partner key alongside the internal one, and returns
 * no PII beyond the identifiers a partner already has.
 */
export const GET = withRoute(async (req: NextRequest) => {
  const denied = requireExportAuth(req)
  if (denied) return denied

  const parsed = parseQuery(req, query)
  if (parsed.error) return parsed.error

  const rows = await prisma.user.findMany({
    where: parsed.data.updatedSince ? { updatedAt: { gte: parsed.data.updatedSince } } : undefined,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    ...cursorArgs(parsed.data.cursor, parsed.data.limit),
    select: {
      id: true,
      email: true,
      name: true,
      slackId: true,
      verificationStatus: true,
      createdAt: true,
      updatedAt: true,
      themeProjects: {
        where: { deletedAt: null },
        select: {
          theme: true,
          title: true,
          githubRepo: true,
          designStatus: true,
          buildStatus: true,
          tier: true,
          grantUsd: true,
          approvedHours: true,
        },
      },
    },
  })

  const page = pageResult(rows, parsed.data.limit)
  return ok({
    items: page.items.map((u) => ({
      ...u,
      themeProjects: u.themeProjects.map((p) => ({
        ...p,
        themeLabel: getThemeDef(p.theme).label,
      })),
    })),
    nextCursor: page.nextCursor,
  })
})
