# Tier candidate pool by knowledge durability pyramid and use two-stage curation

Musement organizes candidate materials into a three-tier Knowledge Durability Pyramid based on epistemic half-life:
- **Evergreen (Base)**: Decadal stability (foundational science, enduring philosophy, timeless mental models).
- **Emerging (Middle)**: Multi-year to monthly stability (substantial architectural deep dives, podcast dialogues, and paradigm shifts).
- **Horizon (Top)**: Fast-changing daily to weekly updates (immediate releases, current events, peripheral tangents).

During collection, AI evaluates and assigns the durability tier dynamically to each material metadata record. Musement exports dedicated RSS feeds for each durability tier (`pool-evergreen.xml`, `pool-emerging.xml`, `pool-horizon.xml`) sorted chronologically to ensure RSS reader stability, while presenting the complete pool with dynamic client-side sorting (including daily seeded shuffle, newest, and fair interleaving) and source filters on the GitHub Pages web portal.

For on-demand curation (`musement pull`), Musement retires rigid 3-slot daily edition constraints in favor of flexible two-stage evaluation: free-form user questions or topics first retrieve matching candidate materials via keyword search, followed by AI editorial ranking and reasoning to select the strongest discoveries with explicit evidence assessments.
