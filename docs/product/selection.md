# Selection

## Hybrid pipeline

AI may contribute structured judgment throughout collection, clustering, summarization, signal assessment, shortlisting, and explanation. Code enforces the product invariants that must not depend on an AI model following instructions correctly.

A daily run proceeds as follows:

1. Gather candidate Materials from the Source Portfolio.
2. Cluster Materials about the same underlying subject into Discoveries.
3. Apply eligibility, exposure, access, provenance, and minimum-quality requirements.
4. Use AI to assess surviving Discoveries for each Selection Slot with evidence and uncertainty.
5. Produce a justified shortlist for Important, Personally Interesting, and Wildcard rather than one universal relevance ranking.
6. Assemble a valid combination, preventing duplicate Discoveries and near-identical topics while enforcing edition-level diversity.
7. If first choices conflict, use the next justified candidate rather than weakening an invariant.
8. Persist a Selection Trace and freeze the resulting Daily Edition.

## Responsibility boundary

AI acts as the editor: it makes qualitative comparisons that should not be reduced to fixed numerical weights. Code enforces:

- Eligibility and prior-exposure rules.
- One distinct Discovery per Selection Slot.
- Story and near-topic deduplication.
- Minimum provenance and quality requirements.
- Edition-level diversity constraints.
- The degraded-edition behavior when a slot cannot be filled honestly.

AI-generated assessments and explanations never override these rules.

## Uncertainty

A controversial argument or early, not-yet-verified signal may be selected when encountering it is itself worthwhile. Its Evidence Status and material uncertainty must be explicit, and Musement never presents an uncertain claim as established fact. Evidence requirements increase with the consequences of getting a claim wrong, so the Important Selection Slot has the strongest context-dependent evidence threshold.

Selection communicates that a Discovery deserves attention; it is not an endorsement of every claim in its Materials.

## Inspectability

The Selection Trace records candidate identities, evidence, structured assessments, uncertainty, rule outcomes, shortlists, and the final assembly decision. It does not store or expose hidden model chain-of-thought.

## AI capability boundary

Pipeline stages use one shared AI capability boundary rather than calling a provider directly. Clustering, summarization, assessment, and selection may each choose task-specific model settings, while the Selection Trace records the provider, model, prompt version, and output-schema version used.

The MVP implements one provider end to end. Supporting several providers or local models is deferred, but provider-specific authentication and request details do not leak into the selection domain.

The MVP provider is the Codex app server using ChatGPT-managed OAuth and subscription access. Subscription limits are visible and never trigger an automatic switch to separately billed API usage.
