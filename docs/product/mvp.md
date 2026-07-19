# Minimum Viable Product

## Hypothesis

Musement can consistently help one user explore more of the world by presenting a tiny, trustworthy, personally shaped Daily Edition without creating information debt.

The MVP exists to test selection quality, not to demonstrate every planned integration or interface.

## Evaluation Window

Evaluate the MVP for one month beginning with the first generated Daily Edition, with at least 20 generated editions during that window. Editions do not need to be consecutive. A missed day is neither a failure nor a backlog item.

If fewer than 20 editions are generated, extend the evaluation until there is enough actual use to judge the hypothesis rather than treating inactivity as product evidence.

## Success Criterion

The MVP succeeds when, after the evaluation window, the user can identify at least five worthwhile Discoveries that they probably would not have encountered otherwise and wants to continue using Musement.

Link opens, optional feedback, downstream selections, and other usage signals are diagnostic evidence. They may help explain the outcome, but none substitutes for the user's retrospective judgment or determines success by itself.

At the end of the trial, Musement presents the first user with the Discovery titles and links from the evaluation window. The user identifies the worthwhile Discoveries they probably would not otherwise have encountered and answers whether they want to continue using Musement. This is a one-time MVP evaluation, not a recurring review feature.

The project owner is the first user and makes the initial success judgment.

## Runtime Boundary

The first-user MVP runs only on the user's local machine. Configuration, SQLite operational state, cached Material, Daily Editions, Selection Traces, and email-delivery receipts remain local. Network access is limited to retrieving sources, invoking the authenticated AI provider, and self-delivering a Daily Edition through the user-authorized Gmail API.

The MVP has no Musement account, hosted backend, cross-device synchronization, or product telemetry.

## Included

- Direct or guided creation of an editable Interest Profile.
- A small, manually editable configuration of trusted public sources for the first user.
- Human-readable files for user-owned settings and one local SQLite database for operational state.
- Public-feed, public-API, and ordinary public-web discovery.
- Collection, normalization, Discovery clustering, deduplication, and temporary raw-content caching.
- AI-assisted editorial assessment with coded eligibility, quality, uniqueness, and diversity guardrails.
- One immutable Daily Edition with Important, Personally Interesting, and Wildcard Selection Slots.
- A configurable Attention Budget and meaningful entry point into Recommended Material.
- The compact Daily Edition display contract through a headless core and CLI.
- Explicit and first-view generation commands, with scheduling delegated to an optional external scheduler.
- Optional HTML self-delivery through a user-installed macOS LaunchAgent and a send-only Gmail OAuth grant.
- Optional one-tap feedback and confirmed Preference Proposals.
- Selection Traces and a consumer-neutral `DiscoverySelected` event stream.
- Codex app server as the single AI provider, using vendor-managed ChatGPT OAuth.

## Deferred

- Weekly review.
- Authenticated source integrations.
- Automatic source onboarding, source recommendations, and a source-management interface.
- Web UI and mobile applications.
- A built-in scheduler or continuously running background service.
- Additional AI providers or local models.
- Automated personal-history imports.
- Podcast, TIL, lesson, and project-specific downstream pipelines.
- Complex interest graphs, numeric strengths, and automatic decay.
- Multi-user or hosted deployment.

Deferred work begins only when evidence from the daily loop identifies a need or validates the core hypothesis.
