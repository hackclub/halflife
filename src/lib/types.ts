export type Phase = "design" | "build";

export type CheckpointKind =
  | "onboarding" // the yellow first-run checkpoint
  | "project" // project creation / tier selection
  | "journal" // journal + timelapse until the hour target
  | "reel" // idea / progress / next reel
  | "submit" // the week gate
  | "demo"; // build-week working-project video

export interface Checkpoint {
  id: string;
  weekId: number;
  kind: CheckpointKind;
  /** Short marker-style label rendered under the puck. */
  title: string;
  /** One line of plain guidance shown in the start bubble. */
  blurb: string;
  /** Journal checkpoints that gate on tracked time carry an hour target. */
  hourTarget?: number;
  /** Journal checkpoints that gate on the habit instead carry an entry count. */
  entryTarget?: number;
  /** A milestone opens on the week's clock, not on the node before it. */
  atHours?: number;
  /** Reel checkpoints carry the brief for what to film. */
  reelBrief?: string;
  /**
   * The two halves of the fork the trail opens once the week is past its tier
   * floor: one more session, or wrap the week up. Both sit on the same row of
   * the trail, and finishing one is what settles the route.
   */
  branch?: "keep" | "submit";
}

/** One saved journal session: the entry, the time claimed, and the evidence. */
export interface SessionLog {
  id: string;
  minutes: number;
  body: string;
  /** When it was saved, epoch ms. The project timeline is ordered on this. */
  at: number;
  /**
   * Timelapse clips picked for this session. The photo evidence is not listed
   * here: it is written into `body` as Markdown images, so the entry and the
   * pictures that back it can never drift apart.
   */
  clips: string[];
}

/** Everything about a week that does not depend on the maker's tier. */
export interface WeekMeta {
  id: number;
  phase: Phase;
  /** "PCB", "CAD"… used for the banner eyebrow and the shop/docs cross-links. */
  theme: string;
  /** The banner headline, e.g. DESIGN YOUR PCB. */
  headline: string;
  /** Long-form name, e.g. Printed Circuit Board Week. */
  fullName: string;
  /** Sentence shown on the week card and in the reveal modal. */
  summary: string;
  /** Beginner explainer used by the onboarding reveal step. */
  primer: string;
  /** Example projects shown to experienced makers instead of the primer. */
  examples: string[];
  accent: string;
  accentDeep: string;
}

export interface Week extends WeekMeta {
  /** The tier of this week's project — it decides how many chapters there are. */
  tier: 1 | 2 | 3;
  /** Hours that fund the project. Above this, time banks instead. */
  fundingHours: number;
  /**
   * Hours before the week can be handed in: the funded hours plus enough
   * banking to keep the cheapest machine reachable. Submitting under this
   * would end the season with no printer, so the gate sits here and not on
   * the funded line. See MIN_HOURS_PER_WEEK.
   */
  submitHours: number;
  /** Funded hours plus the hours your goal asks you to bank. */
  targetHours: number;
  /** Hours that pay for the project rather than banking. Build weeks: none. */
  bankedFrom: number;
  checkpoints: Checkpoint[];
}

export interface Tier {
  id: 1 | 2 | 3;
  funding: number;
  hours: string;
  toBank: string;
  detail: string;
  /** Hours that fund the project — the floor that opens the closing reel. */
  fundingHours: number;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  weekId: number;
  tier: 1 | 2 | 3;
  starter: boolean;
  /** Where the code, schematics and CAD live. Optional, editable any time. */
  githubRepo?: string | null;
}

export type Experience = "first" | "little" | "some" | "lots";

export interface JournalEntry {
  id: string;
  author: string;
  avatar: string;
  project: string;
  flames: number;
  body: string;
  minutes: number;
  when: string;
  group: "Today" | "Yesterday" | "Earlier this week";
  media?: { kind: "board" | "cad" | "scope" | "bench"; caption: string };
}

export interface Reel {
  id: string;
  author: string;
  handle: string;
  fromHQ?: boolean;
  caption: string;
  week: string;
  likes: number;
  comments: number;
  views: number;
  scene: "pcb" | "cad" | "synth" | "display" | "bread" | "hq";
}

export interface ShopItem {
  id: string;
  name: string;
  blurb: string;
  price: number;
  category: "Grants" | "Parts" | "Tools" | "Swag";
  art: "grant" | "printer" | "iron" | "scope" | "kit" | "shirt" | "sticker" | "meter";
  stock: "in" | "low" | "out";
}

export interface DocArticle {
  slug: string;
  title: string;
  section: string;
  minutes: number;
  summary: string;
  body: { heading: string; paragraphs: string[]; list?: string[] }[];
}

export interface LeaderRow {
  rank: number;
  name: string;
  handle: string;
  hours: number;
  ships: number;
  streak: number;
  you?: boolean;
}
