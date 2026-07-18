# Musement

Musement is a personal knowledge-exploration system that curates a deliberately small daily encounter with the wider world.

## Language

**Daily Edition**:
The one canonical, immutable set of selections for a user's local calendar day. It is produced at the scheduled time or, if that run was missed, on first access, and it does not change when revisited or refreshed.
_Avoid_: Daily feed, daily queue, refresh

**Generation Attempt**:
A retryable effort to produce a Daily Edition. A pending or failed attempt is not an edition and records its failure reason without freezing a result for that day.
_Avoid_: Failed edition, degraded edition, draft edition

**Degraded Edition**:
A Daily Edition in which at least one Selection Slot is explicitly unavailable because no Discovery met its quality requirements after the permitted search was broadened. It is an honest failure state, not a successful edition with filler.
_Avoid_: Partial feed, short edition, best effort

**Selection Slot**:
One of the three fixed roles in a Daily Edition: Important, Personally Interesting, or Wildcard. Each Selection Slot contains one Discovery; it is not a continuing topic, separate feed, or reading queue.
_Avoid_: Lane, thread, category

**Exposure**:
A Discovery's appearance in a Daily Edition, whether or not the user opens its recommended Material. An exposed Discovery is not eligible for a later edition unless its underlying subject has materially changed.
_Avoid_: Read, view, impression

**Discovery**:
An underlying idea, work, event, or development judged as a single subject for selection and exposure. Multiple Materials about the same subject belong to one Discovery rather than competing as separate discoveries.
_Avoid_: Article, item, story

**Material**:
A source artifact through which the user can encounter a Discovery, such as a paper, article, lecture, podcast episode, or video. A selected Discovery presents one recommended Material while retaining provenance and alternatives internally.
_Avoid_: Discovery, item, content

**Untrusted Material**:
Any Material while it is being processed by Musement, regardless of source reputation or configuration. Its contents are evidence to interpret and can never authorize instructions, tools, network actions, or policy changes.
_Avoid_: Trusted prompt, executable content, instruction source

**Raw Material Cache**:
A temporary local copy of fetched source text or media used only for processing. It expires rather than becoming part of a personal content archive, and source access rules may shorten or prohibit its retention.
_Avoid_: Content library, permanent archive, knowledge base

**Recommended Material**:
The Material chosen as the most reliable and useful way for the user to encounter a selected Discovery given attention, access, and language constraints. The original source retains explicit provenance but is not automatically the recommendation, and convenience does not justify a shallow substitute.
_Avoid_: Original source, easiest link, summary

**Attention Budget**:
The user's configurable target duration for the entire Daily Edition session: scanning all three selections and meaningfully exploring one. It guides the choice of a useful entry point into Recommended Material but is neither a hard content limit nor a completion obligation, and it may change as the user's circumstances change.
_Avoid_: Time limit, daily quota, required reading time

**Eligible Discovery**:
A Discovery that has not previously been exposed to the user, regardless of when its Materials were published. Older material remains eligible; publication recency matters only when it affects the value of a particular Selection Slot.
_Avoid_: New item, recent item, unread item

**Selection Trace**:
The inspectable record of the candidates, evidence-backed assessments, rule outcomes, shortlist decisions, and final assembly of a Daily Edition. It explains the result without storing or exposing hidden model chain-of-thought.
_Avoid_: Ranking score, model reasoning, debug log

**Evidence Status**:
The explicit account of how well a Discovery's material claims are supported and what uncertainty remains. Selection means the Discovery is worth attention, not that Musement endorses every claim as true.
_Avoid_: Truth score, confidence theater, endorsement

**Discovery Portfolio**:
The bounded mix of interest-led discovery, wider-world horizon scanning, and unfamiliar-topic sampling from which selection candidates are drawn. Personal interests shape what Musement seeks, while the smaller exploratory portions preserve awareness and surprise.
_Avoid_: Universal feed, source firehose

**Interest Profile**:
The inspectable, user-correctable account of the user's curiosity and selection preferences that shapes discovery and selection. It begins with information the user deliberately provides and evolves through later evidence.
_Avoid_: User profile, taste score, engagement profile

**Interest Statement**:
A short label paired with one sentence describing what attracts the user, with optional examples that clarify good or bad matches. It is the human-readable unit used for Enduring and Current Interests.
_Avoid_: Topic tag, keyword, numeric interest

**Enduring Interest**:
A confirmed area of curiosity the user expects to remain meaningful over time.
_Avoid_: Long-term score, permanent interest

**Current Interest**:
A confirmed area the user wants to explore more in their present circumstances, without implying that it will remain enduring.
_Avoid_: Active score, temporary task, project priority

**Preference Proposal**:
An inferred change awaiting explicit user confirmation before it may alter the Interest Profile. Proposals accumulate for non-blocking batch review and never prevent access to a Daily Edition.
_Avoid_: Automatic preference, profile update, interruption

**Handoff Event**:
A versioned, immutable record of something that happened in Musement and when it happened. It describes the domain fact without naming, routing to, or adapting itself for any downstream consumer.
_Avoid_: Command, export file, downstream prompt, routing message

**Handoff Outbox**:
The durable local publication stream from which downstream consumers independently retrieve Handoff Events using their own checkpoints. It is an integration boundary, not a user-visible reading backlog.
_Avoid_: Reading list, saved items, user queue

**Authenticated Source**:
A source the user has authorized Musement to read under the user's own access rights. Authorization permits discovery from the source but does not weaken provenance, quality, or selection requirements.
_Avoid_: Scraped account, shared subscription, public source

**Vendor-Managed Subscription Authentication**:
An official provider flow in which the provider's own runtime manages user login, credentials, refresh, and subscription entitlement while exposing an authenticated AI capability to Musement. It does not pool subscriptions or expose a reusable provider token to the application.
_Avoid_: Subscription sharing, token reuse, API key emulation

**Soft Suppression**:
A reversible reduction in how often a topic or other preference dimension is discovered and selected. Even explicitly declared disinterest remains eligible for exceptional or future exploration rather than becoming a permanent exclusion.
_Avoid_: Block, ban, hard exclusion, blacklist

**Important Selection**:
The Daily Edition Discovery with substantial demonstrated or credibly anticipated consequences, regardless of its age. Personal relevance influences which qualifying Discovery earns the Important Selection Slot but does not create importance by itself.
_Avoid_: Breaking news, current event, globally most important

**Personally Interesting Selection**:
The Daily Edition Discovery with the strongest fit to the user's curiosity, taste, and potential learning value. It requires sufficient quality but does not require substantial wider-world consequences.
_Avoid_: Personalized importance, productivity recommendation

**Wildcard Selection**:
The Daily Edition Discovery outside the user's established interests or recent exposure patterns that still has an explainable reason to reward attention. Unfamiliarity alone is insufficient; the Discovery and its recommended Material must satisfy the same quality floor as the other Selection Slots.
_Avoid_: Random item, novelty for novelty's sake

A Discovery may qualify for more than one Selection Slot. It occupies the slot it satisfies most distinctly, and another Discovery fills each remaining slot.
