import Script from "next/script"

/**
 * Plausible's snippet, as Plausible hands it out, for the <head> of a root
 * layout: the script itself, and the stub that queues calls made before it
 * has loaded. Cookieless, so no consent banner rides along with it.
 *
 * Through next/script rather than bare <script> tags: React refuses to run an
 * inline script it renders on the client, and says so in the console. Either
 * may land first — the stub and the library each keep whatever the other set.
 *
 * In the landing site's and the platform's layouts, and deliberately not the
 * phone hand-off's: that page's path is `/r/<token>`, and Plausible records
 * every path it sees — the token would go to a third party.
 */
export function PlausibleAnalytics() {
	return (
		<>
			<Script src="https://plausible.io/js/pa-2AUFAV5QT0nnEWNJcAR12.js" strategy="afterInteractive" />
			{/* Plausible's fixed init stub; nothing from a user goes into it. */}
			<Script
				id="plausible-init"
				strategy="afterInteractive"
				dangerouslySetInnerHTML={{
					__html:
						"window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};plausible.init()",
				}}
			/>
		</>
	)
}
