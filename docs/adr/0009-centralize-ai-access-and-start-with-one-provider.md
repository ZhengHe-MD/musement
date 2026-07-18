# Centralize AI access and start with one provider

All model-assisted stages use a shared AI capability boundary with task-specific settings and traceable model, prompt, and schema versions. The MVP implements one provider end to end; scattering provider calls through the pipeline would make later authentication or provider changes invasive, while implementing a multi-provider matrix before validating selection quality would add complexity without evidence of need.
