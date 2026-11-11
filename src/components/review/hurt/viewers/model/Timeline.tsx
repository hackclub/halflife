import { useEffect, useMemo, useRef, useState } from 'react'
import HurtIcon, { type HurtIconName } from '../../ui/HurtIcon'
import { ToolButton } from '../../ui/parts'
import type { ModelTimeline } from './analyze'

const ICONS: Record<string, HurtIconName> = {
  sketch: 'sketch',
  extrude: 'extrude',
  revolve: 'revolve',
  sweep: 'sweep',
  loft: 'loft',
  fillet: 'fillet',
  chamfer: 'chamfer',
  shell: 'shell',
  hole: 'hole',
  thread: 'thread',
  combine: 'combine',
  split: 'split',
  move: 'move',
  mirror: 'mirror',
  pattern: 'pattern',
  component: 'cube',
  joint: 'joint',
  plane: 'plane',
  base: 'base',
  emboss: 'emboss',
  remove: 'remove',
  copy: 'copy',
  scale: 'scale',
  canvas: 'image',
  primitive: 'primitive',
}

const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

type Item = { step: number } | { group: number; name: string; start: number; end: number }

function layout(timeline: ModelTimeline) {
  const items: Item[] = []
  const groups = [...timeline.groups].sort((a, b) => a.start - b.start)
  for (let step = 0, next = 0; step < timeline.steps.length; ) {
    while (next < groups.length && groups[next].start < step) next++
    const group = groups[next]
    if (group?.start === step) {
      items.push({ group: next, ...group })
      step = group.end + 1
    } else items.push({ step: step++ })
  }
  return items
}

export default function Timeline({
  timeline,
  step,
  onStep,
  status,
}: {
  timeline: ModelTimeline
  step: number
  onStep: (step: number) => void
  status: string | null
}) {
  const [open, setOpen] = useState<Set<number>>(new Set())
  const track = useRef<HTMLDivElement>(null)
  const items = useMemo(() => layout(timeline), [timeline])
  const last = timeline.steps.length - 1
  const time = timeline.times[step]

  useEffect(() => {
    track.current?.querySelector('.is-current')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [step, open])

  const describe = (i: number) => {
    const at = timeline.times[i]
    return at === null ? timeline.steps[i] : `${timeline.steps[i]} · ${when.format(at)}`
  }

  const button = (i: number) => (
    <button
      key={i}
      type="button"
      className={`hurt-timeline__step${i === step ? ' is-current' : ''}${i > step ? ' is-ahead' : ''}`}
      title={describe(i)}
      aria-label={describe(i)}
      aria-current={i === step ? 'step' : undefined}
      onClick={() => onStep(i)}
    >
      <HurtIcon name={ICONS[timeline.kinds[i]] ?? 'feature'} />
    </button>
  )

  return (
    <div className="hurt-timeline">
      <div className="hurt-timeline__controls">
        <ToolButton icon="first" label="First step" disabled={step === 0} onClick={() => onStep(0)} />
        <ToolButton icon="back" label="Previous step" disabled={step === 0} onClick={() => onStep(step - 1)} />
        <ToolButton icon="next" label="Next step" disabled={step === last} onClick={() => onStep(step + 1)} />
        <ToolButton icon="last" label="Last step" disabled={step === last} onClick={() => onStep(last)} />
        <input
          type="range"
          min={0}
          max={last}
          step={1}
          value={step}
          aria-label="Timeline step"
          onChange={(e) => onStep(Number(e.target.value))}
        />
        <span className="hurt-timeline__label">
          {timeline.steps[step]}
          {time !== null && <span className="hurt-timeline__time">{when.format(time)}</span>}
          <span className="hurt-timeline__time">
            {step + 1} of {timeline.steps.length}
          </span>
        </span>
        {status && <span className="hurt-timeline__time">{status}</span>}
      </div>
      <div ref={track} className="hurt-timeline__track">
        {items.map((item) => {
          if ('step' in item) return button(item.step)
          const expanded = open.has(item.group)
          const inside = step >= item.start && step <= item.end
          return (
            <div key={`group-${item.group}`} className={`hurt-timeline__group${expanded ? ' is-open' : ''}`}>
              <button
                type="button"
                className={`hurt-timeline__step hurt-timeline__toggle${inside && !expanded ? ' is-current' : ''}${item.start > step ? ' is-ahead' : ''}`}
                title={`${item.name} (${item.end - item.start + 1} steps)`}
                aria-label={`${item.name}, ${expanded ? 'collapse' : 'expand'}`}
                aria-expanded={expanded}
                onClick={() =>
                  setOpen((current) => {
                    const next = new Set(current)
                    if (!next.delete(item.group)) next.add(item.group)
                    return next
                  })
                }
              >
                <HurtIcon name="group" />
                <HurtIcon name={expanded ? 'back' : 'chevron'} className="hurt-timeline__chevron" />
              </button>
              {expanded && Array.from({ length: item.end - item.start + 1 }, (_, k) => button(item.start + k))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
