"use client"

import Link from "next/link"
import type { ReactNode } from "react"
import { useStore } from "@/lib/store"

/**
 * A link into a doc. Opening an article is the moment someone commits to
 * reading, so it folds the Doomscroller away and hands the width back to the
 * page. The Doomscroller button in the header brings it back.
 */
export function ArticleLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const { setDoomscroller } = useStore()

  return (
    <Link href={href} className={className} onClick={() => setDoomscroller(false)}>
      {children}
    </Link>
  )
}
