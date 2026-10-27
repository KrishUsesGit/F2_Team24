import { useMemo, useState } from 'react'
import type { Bundle } from '../data/schema.ts'
import { buildExplanation } from './guidedExplanation.ts'
import { Pill } from './primitives/Pill.tsx'
import { Sticker } from './primitives/Sticker.tsx'

/**
 * Explanation panel for the selected trial, with an optional five-step
 * walkthrough. Rendered inside the per-trial view, so it is rebuilt from the
 * newly loaded bundle (and the walkthrough restarts) whenever the trial changes.
 */
export function GuidedExplanation({ bundle }: { bundle: Bundle }) {
  const steps = useMemo(() => buildExplanation(bundle), [bundle])
  const [step, setStep] = useState<number | null>(null)
  const current = step === null ? null : steps[step]

  return (
    <Sticker as="section" tone="mint" className="p-5 md:p-8" aria-labelledby="guided-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="guided-title" className="font-display text-2xl font-bold md:text-3xl">
            Guided explanation
          </h2>
          <p className="mt-1 text-ink-soft">
            For trial <span className="font-mono">{bundle.trial_id}</span>, from its stored data only.
          </p>
        </div>
        {step === null ? (
          <Pill tone="signal" onClick={() => setStep(0)}>
            Start the 5-step walkthrough
          </Pill>
        ) : null}
      </div>

      {current && step !== null ? (
        <div className="mt-6" data-testid="walkthrough">
          <p className="font-mono text-sm font-semibold" data-testid="walkthrough-progress">
            Step {step + 1} of {steps.length}
          </p>
          <div aria-live="polite">
            <h3 className="mt-1 font-display text-xl font-bold">{current.title}</h3>
            <div className="mt-3 max-w-3xl space-y-3 text-lg">
              {current.paragraphs.map((text) => (
                <p key={text}>{text}</p>
              ))}
            </div>
          </div>
          <p className="mt-3">
            <a href={current.target} className="font-semibold underline underline-offset-4">
              Show this on the page
            </a>
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Pill disabled={step === 0} onClick={() => setStep(step - 1)}>
              Previous
            </Pill>
            <Pill disabled={step === steps.length - 1} onClick={() => setStep(step + 1)}>
              Next
            </Pill>
            <Pill onClick={() => setStep(null)}>Exit walkthrough</Pill>
          </div>
        </div>
      ) : (
        <div className="mt-6 grid gap-5 md:grid-cols-2" data-testid="explanation-overview">
          {steps.map((item) => (
            <article key={item.id} className="rounded-2xl border-[3px] border-ink bg-paper p-4" aria-labelledby={`guided-${item.id}`}>
              <h3 id={`guided-${item.id}`} className="font-display text-base font-bold">
                {item.title}
              </h3>
              <div className="mt-2 space-y-2 text-sm">
                {item.paragraphs.map((text) => (
                  <p key={text}>{text}</p>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </Sticker>
  )
}
