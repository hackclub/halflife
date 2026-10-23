import "server-only"

/**
 * A queue that lets at most `max` callers through at once.
 *
 * Both forge clients cap their concurrency for the same reason – a burst of hand-ins is a spike against a per-second quota – but they cap different pools: reads over the shared proxy, writes over each maker's own token. Each module therefore gets its own instance from this factory rather than sharing one counter, which would make a read queue behind an unrelated write.
 */
function createSlot(max: number): () => Promise<() => void> {
	let inFlight = 0
	const waiting: (() => void)[] = []

	return async () => {
		if (inFlight >= max) await new Promise<void>(resolve => waiting.push(resolve))
		inFlight++
		return () => {
			inFlight--
			waiting.shift()?.()
		}
	}
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

export { createSlot, sleep }
