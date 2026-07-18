# Product Overview

Musement is a local, single-user knowledge-exploration system. It helps a busy person encounter more of the wider world through one deliberately small Daily Edition without creating an inbox, unread queue, or completion obligation.

## Core loop

1. The user provides an editable Interest Profile and a small configuration of trusted public sources.
2. Musement gathers public Materials and discovers related sources, then groups Materials about the same underlying subject into Discoveries.
3. AI makes evidence-backed editorial assessments while code enforces eligibility, quality, uniqueness, provenance, and diversity rules.
4. Musement freezes one Daily Edition for the user's local date with three distinct Selection Slots: Important, Personally Interesting, and Wildcard.
5. The user scans all three and may explore one within a configurable Attention Budget. Missing a day creates no debt.
6. Feedback is optional. Profile changes are proposed and require confirmation. Explicit downstream selection emits a consumer-neutral event without launching another workflow.

An infrastructure failure produces a retryable Generation Attempt, not an edition. Genuine candidate scarcity may produce a Degraded Edition with an explicitly unavailable slot; Musement never inserts filler merely to reach three selections.

## MVP experiment

The first user runs Musement locally for one month and generates at least 20 editions. The experiment succeeds when the user can identify at least five worthwhile Discoveries they probably would not otherwise have encountered and wants to continue using Musement.

The first version is a headless core and CLI. It uses readable files for user-owned configuration, SQLite for operational state, public sources, and Codex app server with ChatGPT-managed OAuth. It has no hosted backend, account system, built-in scheduler, web UI, or authenticated-source connector.

## Detailed contracts

- [Minimum Viable Product](mvp.md)
- [Daily Edition](daily-edition.md)
- [Selection](selection.md)
- [Interest Profile](interest-profile.md)
- [Source Portfolio](source-portfolio.md)
- [Downstream Handoff](downstream-handoff.md)
- [Domain language](../../CONTEXT.md)
- [Architectural decisions](../adr/)
- [AI provider boundary](../architecture/ai-provider.md)
- [Content safety boundary](../architecture/content-safety.md)
- [Subscription-backed authentication research](../research/subscription-backed-ai-auth.md)

## Deferred until evidence warrants expansion

Weekly review, authenticated source integrations, automatic source onboarding, additional AI providers, a built-in scheduler, hosted or multi-user operation, graphical interfaces, personal-history imports, and downstream content pipelines are outside the MVP.
