# Source Portfolio

## Composition

Musement uses a hybrid source portfolio:

- **Configured sources** form a trusted core explicitly chosen for recurring discovery.
- **Discovered public sources** may enter through search, citations, and references found during exploration.

Configuration does not guarantee that a Material will be selected, and discovery does not grant a source automatic trust. Every Material remains subject to provenance and quality requirements.

The user may add a source or apply Soft Suppression to one. Authenticated Sources always require explicit user configuration and authorization.

For the first-user trial, the Configured Sources are bootstrapped as a small, manually editable configuration file containing public sources the user already trusts. Musement may still find additional public sources through its ordinary discovery process. Automatic source onboarding, source recommendations, and a source-management interface are not required to test the MVP hypothesis.

## MVP boundary

The MVP proves the complete daily loop using public feeds, public APIs, and ordinary public web Materials. Its source-adapter and secret-handling boundaries must allow authenticated connectors later, but the MVP does not implement integrations for authenticated platforms. The first authenticated connector is considered only after daily selection quality is credible.

## Content retention

Fetched or extracted source text and media live in a Raw Material Cache for processing, with a configurable default retention of seven days. A source's access, licensing, or retention rules may require a shorter period or prohibit local caching entirely.

Musement persists URLs, metadata, fingerprints, provenance, derived summaries, and Selection Traces separately. It is not a permanent archive of source content.
