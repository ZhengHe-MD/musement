# Keep events consumer-neutral

Musement events describe immutable, past-tense domain facts and their occurrence times without destinations, routing hints, workflow names, prompts, or consumer-specific payloads. `DiscoverySelected` carries enough factual metadata to be understood independently but excludes the source content itself. Consumers decide independently whether and how to react; encoding their intentions in the event would turn it into a disguised command, while forcing them to query Musement for basic facts would create temporal coupling.
