# Interest Profile

## Initial profile

The first version starts from an Interest Profile that the user deliberately provides. The user may either edit it directly or answer a short guided interview similar to a grilling session; both paths produce the same inspectable and editable profile.

Musement does not import browsing history, social history, or other personal archives during initial onboarding. It learns gradually from subsequent use after the basic selection loop is operating.

The initial model has three user-facing groups:

- **Enduring Interests** for curiosity expected to persist.
- **Current Interests** for what the user wants to explore more in their present circumstances.
- **Soft Suppressions** for what should appear less often without becoming permanently ineligible.

The first version does not add separate temporary or dormant kinds, numeric interest strengths, or automatic decay policies.

Each Enduring or Current Interest is an Interest Statement containing:

- A short label.
- One sentence describing what attracts the user.
- Optional examples that clarify good or bad matches.

An Interest Statement is not an opaque topic tag. For example: “Physics — conceptual explanations that reshape how I understand reality; prefer intuition and historical context over routine calculation exercises.”

## Ownership and learning

Declared preferences and inferred evidence remain distinguishable. Observed behavior may create evidence that a preference has changed, but Musement never silently rewrites a user-declared preference or applies an inferred preference change to the Interest Profile. Every profile change requires explicit user confirmation and remains inspectable and correctable afterward.

Inferred changes accumulate as Preference Proposals for compact, non-blocking batch review. The user may review them when convenient; pending proposals never block or interrupt access to a Daily Edition.
