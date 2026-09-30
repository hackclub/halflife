/**
 * Plausible's snippet, as Plausible hands it out, for the <head> of a root
 * layout: the script itself, and the stub that queues calls made before it
 * has loaded. Cookieless, so no consent banner rides along with it.
 *
 * In the landing site's and the platform's layouts, and deliberately not the
 * phone hand-off's: that page's path is `/r/<token>`, and Plausible records
 * every path it sees — the token would go to a third party.
 */
export function PlausibleAnalytics() {
  return (
    <>
      <script async src="https://plausible.io/js/pa-2AUFAV5QT0nnEWNJcAR12.js" />
      {/* Plausible's fixed init stub; nothing from a user goes into it. */}
      <script
        dangerouslySetInnerHTML={{
          __html:
            "window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};plausible.init()",
        }}
      />
    </>
  )
}
