import type { Metadata, Viewport } from "next"
import { PlausibleAnalytics } from "@/components/PlausibleAnalytics"
import { siteFontVariables } from "@/components/site/fonts"
import "./globals.css"

export const metadata: Metadata = {
  title: "Half Life by Hack Club",
  description:
    "Ten weeks. Five projects designed, five projects built. Hack Club funds your parts and ships you a 3D printer at the end. Ages 13-18, no experience needed.",
  openGraph: {
    title: "Half Life by Hack Club",
    description: "Design five hardware projects, then build all five. Hack Club funds the parts and ships the prizes.",
    type: "website",
  },
}

export const viewport: Viewport = {
  themeColor: "#31222c",
  colorScheme: "dark",
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${siteFontVariables} h-full antialiased`}>
      <head>
        <PlausibleAnalytics />
      </head>
      <body className="min-h-full flex flex-col bg-hl-ink text-hl-paper">{children}</body>
    </html>
  )
}
