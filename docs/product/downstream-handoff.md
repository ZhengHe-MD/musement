# Downstream Handoff

## Boundary

A downstream workflow may react only after the user explicitly selects a Discovery. Musement then records a versioned `DiscoverySelected` JSON Handoff Event; it does not launch or control a downstream consumer.

Consumers depend on the handoff contract rather than Musement's database, internal ranking signals, or implementation details.

`DiscoverySelected` is an immutable, consumer-neutral statement of fact. It records what happened and when it happened, along with stable identifiers and the factual Discovery, Recommended Material, Daily Edition, and Selection Slot context needed to understand the occurrence. It contains no destination, routing hint, workflow name, downstream prompt, or consumer-specific payload.

The event carries a compact metadata snapshot so consumers do not need to query Musement to understand what was selected. That snapshot includes stable identifiers, the Discovery title and summary, Recommended Material metadata and URL, provenance, the Daily Edition date, and the Selection Slot. It does not contain downloaded, extracted, or full source content; each consumer retrieves Material under its own access and retention rules.

## Contract evolution

Every event carries a stable `event_type` and integer `event_version`. Adding optional metadata is backward-compatible within the same version. Removing, renaming, retyping, or changing the meaning of a field requires a new version.

Recorded events are immutable and are never rewritten into a newer shape. Consumers ignore unknown fields and explicitly declare which event versions they support.

## Delivery

Musement persists each Handoff Event in a durable local Handoff Outbox. Each downstream consumer reads events using its own checkpoint, so one consumer cannot acknowledge or remove an event on behalf of another. This allows handoffs to survive process restarts and selections made through any interface.

Delivery is at least once. Every event has a globally unique `event_id` and an ordered stream position distinct from its occurrence time. Consumers persist their own checkpoints and deduplicate retries by `event_id`; Musement does not claim exactly-once processing across downstream systems.

The MVP does not automatically expire Handoff Events. Any later export or purge is an explicit user action rather than a retention timer.

The interface sequence is:

1. The MVP exposes event retrieval through the CLI with stable JSON output and a cursor or checkpoint. A selection command may also print the event it recorded to stdout for immediate composition.
2. A later local HTTP API exposes the same outbox contract and is documented with OpenAPI.
3. Optional webhook delivery may be added as another adapter, with its own authentication and retry behavior.

A message broker is not required for the personal, single-user MVP.
