import Link from "next/link"

import { siteFontVariables } from "@/components/site/fonts"
import { MissingPath } from "@/components/site/missing-path"
import { PLATFORM_HOME } from "@/lib/routes"
import { BRAND } from "@/lib/site/content"
import { STACK_VIEW, stackWeld } from "@/lib/site/stage"
import styles from "./not-found.module.css"

/**
 * The 404: the production line, run out.
 *
 * The landing draws the programme as a line — a header plate, then a tapered
 * weld down into each station. Here the weld leaves the header and is sheared
 * off before it lands, and the station it was heading for is one of the
 * page's own reserved slots, empty, labelled with the address that was asked
 * for. Nothing enters or moves: like the landing, the drawing is complete from
 * the first paint.
 */

/**
 * The cut, in the weld's own 200x120 viewBox. A sawtooth across the band a
 * little past half its run, so the end reads as sheared rather than as a band
 * that simply stopped short.
 */
const SHEAR = "M0 0H200V66L186 76L172 64L158 78L144 66L130 76L116 64L102 78L88 66L74 76L60 64L46 78L32 66L18 76L0 64Z"

export function NotFoundScene() {
  return (
    <main className={`${styles.scene} ${siteFontVariables}`}>
      <div className={styles.column}>
        <Link href="/" className={styles.wordmark}>
          {BRAND.name.toLowerCase()}
        </Link>

        <div className={styles.head}>
          <h1 className={styles.plate}>this page isn&rsquo;t on the map</h1>
          <svg
            viewBox={`0 0 ${STACK_VIEW.w} ${STACK_VIEW.h}`}
            preserveAspectRatio="none"
            fill="none"
            aria-hidden="true"
            focusable="false"
            className={styles.weld}
          >
            <defs>
              <clipPath id="hl-404-shear">
                <path d={SHEAR} />
              </clipPath>
            </defs>
            <path d={stackWeld("right")} fill="var(--color-hl-lavender-pale, #e6e5fc)" clipPath="url(#hl-404-shear)" />
          </svg>
        </div>

        <section className={styles.slot} aria-labelledby="hl-404-label">
          <span aria-hidden="true" className={styles.grid} />
          <span aria-hidden="true" className={styles.edge} />
          <span aria-hidden="true" className={`${styles.tick} ${styles.tl}`} />
          <span aria-hidden="true" className={`${styles.tick} ${styles.tr}`} />
          <span aria-hidden="true" className={`${styles.tick} ${styles.bl}`} />
          <span aria-hidden="true" className={`${styles.tick} ${styles.br}`} />

          <div className={styles.body}>
            <h2 id="hl-404-label" className={styles.label}>
              station 404
            </h2>
            <MissingPath className={styles.path} />
            <p className={styles.text}>
              This page doesn&rsquo;t exist (or you don&rsquo;t have permission to view it!)
            </p>
          </div>
        </section>

        <nav className={styles.actions} aria-label="Ways back">
          <Link href={PLATFORM_HOME} className={styles.primary}>
            back to your map
          </Link>
          <Link href="/" className={styles.secondary}>
            {BRAND.name.toLowerCase()} home
          </Link>
        </nav>
      </div>
    </main>
  )
}
