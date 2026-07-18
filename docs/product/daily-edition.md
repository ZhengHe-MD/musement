# Daily Edition

## Lifecycle

Musement produces one canonical Daily Edition for each day in the user's local timezone. It is generated at a configured time or on first access if the scheduled run was missed. Once generated, it is immutable: revisiting or refreshing it never changes its selections.

The MVP does not run its own scheduler or background service. An explicit CLI command may generate today's edition, and asking to view today generates it when none exists. Users may later invoke the same generation command with an external scheduler such as `cron` or `launchd`; this does not change the edition lifecycle.

Before an edition exists, each run is a retryable Generation Attempt. Provider unavailability, authentication failure, exhausted subscription limits, or other infrastructure failures leave the attempt pending or failed with a reason; they do not create or freeze a Daily Edition. Musement retries after the dependency becomes available, including on first access.

## Selection Slots

A successful Daily Edition contains one distinct Discovery in each Selection Slot:

1. Important
2. Personally Interesting
3. Wildcard

If a slot cannot be filled after the permitted search is broadened by an otherwise healthy pipeline, Musement does not lower its quality requirements. The slot remains explicitly unavailable and the Daily Edition is marked degraded. Infrastructure and authentication failures are failed Generation Attempts, not degraded editions.

## Default display contract

Each filled Selection Slot shows:

- Discovery title
- One-sentence explanation of what it is
- One-sentence explanation of why it earned this Selection Slot
- Recommended Material's author, source, format, and link
- Meaningful-entry time and full length
- Any material uncertainty or access requirement

Detailed scoring, alternative Materials, and full provenance remain available on demand rather than appearing in the default view.

## Attention

The user configures one Attention Budget for the entire Daily Edition session. The intended pattern is to scan all three selections and meaningfully explore one; the budget is a planning preference, not a hard limit or completion obligation.

Recommended Material may exceed the Attention Budget when Musement can identify a chapter, section, excerpt, or introductory alternative that provides meaningful value within the available exploration time. The display distinguishes the estimated time for that entry point from the Material's full length.

## Feedback

Feedback is always optional. Musement never blocks access or future editions, sends completion pressure, or interprets missing feedback as a negative signal. No feedback means the user's reaction is unknown.

The initial explicit feedback set is deliberately small:

- **Good pick** reinforces the overall selection.
- **Not useful** optionally asks whether the problem was topic, source, depth, repetition, timing, or another reason.
- **Already knew this** corrects the novelty judgment without suppressing the topic.

Selecting a Discovery for a downstream workflow is a separate, stronger signal rather than another quick-feedback control.
