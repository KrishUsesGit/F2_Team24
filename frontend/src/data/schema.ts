/**
 * Runtime schemas for the presentation JSON that the Python pipeline already
 * produces (`present/path_bundle.py`). They describe what exists; they do not
 * add fields, endpoints or states. Objects are "loose": unknown extra fields
 * are preserved, so a newer bundle never fails just because it carries more.
 * Fields that older (historical) bundles lack are optional.
 */
import { z } from 'zod'

export const RESULT_STATES = ['localized', 'partially_localized', 'not_localized', 'no_degradation'] as const
export const HOP_STATUSES = ['healthy', 'degraded', 'unknown'] as const
export const CONFIDENCE_LEVELS = ['high', 'medium', 'low', 'insufficient'] as const
export const HOP_COUNT = 5

export const resultStateSchema = z.enum(RESULT_STATES)
export const hopStatusSchema = z.enum(HOP_STATUSES)
export const confidenceLevelSchema = z.enum(CONFIDENCE_LEVELS)

const hopNumber = z.int().min(1).max(HOP_COUNT)

export const hopRangeSchema = z
  .object({ min: hopNumber, max: hopNumber })
  .refine((r) => r.min <= r.max, { message: 'hop_range.min must not exceed hop_range.max' })

export const metricSchema = z.looseObject({
  numerator: z.int(),
  denominator: z.int(),
  rate: z.number().nullable(),
  ci95: z.tuple([z.number().nullable(), z.number().nullable()]).nullable().optional(),
})
export type Metric = z.infer<typeof metricSchema>

export const brierSchema = z.looseObject({ n: z.int(), brier: z.number().nullable() })

export const gateCheckSchema = z.looseObject({
  within_1_hop_accuracy_pass: z.boolean(),
  false_attribution_rate_pass: z.boolean(),
  overall_pass: z.boolean(),
})

export const evaluationSummarySchema = z.looseObject({
  n_trials: z.int(),
  n_positive: z.int(),
  n_negative_clean_control: z.int(),
  exact_hop_accuracy: metricSchema,
  within_1_hop_accuracy: metricSchema,
  false_attribution_rate: metricSchema,
  clean_control_false_positive_rate: metricSchema,
  detection_precision: metricSchema,
  detection_recall: metricSchema,
})

const confidenceFactorsSchema = z.looseObject({
  corroborating_hops: z.array(hopNumber).optional(),
  corroborating_fraction: z.number().optional(),
  unknown_hops: z.array(hopNumber).optional(),
  completeness_fraction: z.number().optional(),
  note: z.string().optional(),
  reason: z.string().optional(),
})

export const claimSchema = z.discriminatedUnion('tag', [
  z.looseObject({
    tag: z.literal('fact'),
    text: z.string(),
    data_ref: z.record(z.string(), z.unknown()).optional(),
  }),
  z.looseObject({ tag: z.literal('inference'), text: z.string(), hop_range: hopRangeSchema.nullable() }),
  z.looseObject({ tag: z.literal('correlation'), text: z.string(), lag_ms: z.number().nullable() }),
  z.looseObject({
    tag: z.literal('confidence'),
    level: confidenceLevelSchema,
    score: z.number(),
    factors: confidenceFactorsSchema,
  }),
  z.looseObject({ tag: z.literal('unknown'), text: z.string(), hops: z.array(hopNumber) }),
])
export type Claim = z.infer<typeof claimSchema>

export const hopSchema = z.looseObject({
  ttl: hopNumber,
  ip: z.string().nullable(),
  all_ips: z.array(z.string()),
  status: hopStatusSchema,
  rtt_baseline_ms: z.number().nullable(),
  rtt_observed_ms: z.number().nullable(),
  onset_ns: z.number().nullable(),
  sample_count: z.int(),
  why_highlighted: z.array(z.string()),
})
export type Hop = z.infer<typeof hopSchema>

export const appTimelineSampleSchema = z.looseObject({
  seq: z.int(),
  t_send_mono_ns: z.number(),
  rtt_ms: z.number().nullable(),
  responded: z.boolean(),
})

export const evaluationBlockSchema = z.looseObject({
  scope: z.string(),
  source_file: z.string(),
  // Absent in every bundle generated before the exposed-set labelling (WP-1).
  evidence_status: z.string().optional(),
  summary: evaluationSummarySchema.nullable().optional(),
  brier_score: brierSchema.nullable().optional(),
  gate_check: gateCheckSchema.nullable().optional(),
  algorithm: z.string().nullable().optional(),
  git_commit: z.string().nullable().optional(),
})
export type EvaluationBlock = z.infer<typeof evaluationBlockSchema>

export const bundleSchema = z.looseObject({
  trial_id: z.string().min(1),
  plain_language: z.looseObject({ result_state: resultStateSchema, summary: z.string().min(1) }),
  hop_range: hopRangeSchema.nullable(),
  confidence: z.looseObject({
    level: confidenceLevelSchema,
    score: z.number(),
    factors: confidenceFactorsSchema,
  }),
  alignment_delta_ms: z.number().nullable(),
  observation_window: z.looseObject({
    t_start_ns: z.number().nullable(),
    t_end_ns: z.number().nullable(),
    duration_s: z.number().nullable(),
  }),
  evidence_record_claims: z.array(claimSchema).optional(),
  app: z.looseObject({
    onset_ns: z.number().nullable(),
    rtt_baseline_ms: z.number().nullable(),
    rtt_observed_ms: z.number().nullable(),
    sample_count: z.int(),
    timeline: z.array(appTimelineSampleSchema),
  }),
  hops: z.array(hopSchema).length(HOP_COUNT),
  unknown_hops: z.array(hopNumber),
  evaluation: evaluationBlockSchema.optional(),
})
export type Bundle = z.infer<typeof bundleSchema>
export type ResultState = z.infer<typeof resultStateSchema>
export type HopStatus = z.infer<typeof hopStatusSchema>

export const manifestSchema = z.object({
  schema: z.literal(1),
  trials: z.array(z.object({ id: z.string().min(1) })),
})
export type Manifest = z.infer<typeof manifestSchema>

/**
 * Aggregate-only evaluation projection served by the data layer
 * (vite/dataAllowlist.ts). Strict on purpose: a per-trial field appearing here
 * would be a data-exposure bug and must fail loudly rather than be displayed.
 */
export const evaluationProjectionSchema = z.strictObject({
  schema: z.literal(1),
  phase: z.enum(['4', '4b']),
  source_files: z.array(z.string()),
  algorithm: z.string(),
  algorithm_params: z.record(z.string(), z.number()),
  delta_align_ns: z.number(),
  unknown_fraction_threshold: z.number(),
  n_trials: z.int(),
  n_positive: z.int(),
  n_negative_clean_control: z.int(),
  metrics: z.strictObject({
    exact_hop_accuracy: metricSchema,
    within_1_hop_accuracy: metricSchema,
    false_attribution_rate: metricSchema,
    clean_control_false_positive_rate: metricSchema,
    detection_precision: metricSchema,
    detection_recall: metricSchema,
  }),
  brier_score: brierSchema,
  git_commit: z.string().optional(),
  validation_type: z.string().optional(),
  gate_check: gateCheckSchema.optional(),
  known_unresolved_limitation: z.string().optional(),
})
export type EvaluationProjection = z.infer<typeof evaluationProjectionSchema>
