# Use AI editorial judgment with coded guardrails

Musement may use AI throughout the selection pipeline for qualitative, evidence-backed editorial judgment, but code enforces eligibility, exposure, deduplication, quality, diversity, slot uniqueness, and degraded-edition behavior. Pure hard-coded scoring would create false precision, while an unconstrained end-to-end ranking prompt could silently violate product invariants; the hybrid preserves flexible judgment and an inspectable Selection Trace without storing hidden chain-of-thought.
