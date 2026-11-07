import { maxRating, ratingFromLabels, type Rating } from './ratings.js'

/**
 * atproto moderation labels as blueyvatar enforces them (issue #207).
 * Spec: https://atproto.com/specs/label . Values: https://raw.githubusercontent.com/bluesky-social/atproto/main/lexicons/com/atproto/label/defs.json
 */
export const REMOVE_LABELS = ['!takedown', '!suspend'] as const
export const HIDE_LABEL = '!hide'
export const RATING_LABELS = ['porn', 'sexual', 'nudity', 'graphic-media'] as const
export const ENFORCED_LABELS: readonly string[] = [...REMOVE_LABELS, HIDE_LABEL, ...RATING_LABELS]

/** An active label on a subject: a DID, or an at:// record URI. */
export interface SubjectLabel { subject: string; val: string }

export const isEnforcedLabel = (val: string): boolean => ENFORCED_LABELS.includes(val)

/**
 * Views the active labels of one DID. Account labels (subject is the DID) apply to everything the DID owns;
 * record labels apply to that record. Removal covers !takedown, !suspend and !hide: the image is not served.
 * Ratings only ever go up: the effective rating is the highest of the stored rating and every label's rating.
 */
export class LabelView {
  constructor(private readonly did: string, private readonly labels: readonly SubjectLabel[]) {}

  private vals(subject: string): string[] { return this.labels.filter((l) => l.subject === subject).map((l) => l.val) }
  private static removes(vals: string[]): boolean { return vals.some((v) => (REMOVE_LABELS as readonly string[]).includes(v) || v === HIDE_LABEL) }

  accountRemoved(): boolean { return LabelView.removes(this.vals(this.did)) }
  recordRemoved(uri: string): boolean { return this.accountRemoved() || LabelView.removes(this.vals(uri)) }
  /** Highest of `base`, the account labels, and the record labels. Never lower than `base`. */
  effectiveRating(base: Rating, uri?: string): Rating {
    const raised = ratingFromLabels([...this.vals(this.did), ...(uri ? this.vals(uri) : [])])
    return maxRating(base, raised)
  }
  /** True when any record of this DID other than the given URIs carries a removal label (used for blob serving). */
  anyRecordRemoved(uris: readonly string[]): boolean { return this.accountRemoved() || uris.some((u) => LabelView.removes(this.vals(u))) }
}

export const labelSubjectDid = (subject: string): string | null => {
  const m = /^(did:[a-z]+:[A-Za-z0-9._:%-]+)$/.exec(subject) ?? /^at:\/\/(did:[a-z]+:[A-Za-z0-9._:%-]+)(?:\/|$)/.exec(subject)
  return m?.[1] ?? null
}

