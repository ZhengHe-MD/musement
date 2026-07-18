# Treat all source content as untrusted data

Musement treats every collected Material as untrusted data and processes it with tool-less model calls that return validated structured output. Fetching, link traversal, credentials, and execution stay in code-controlled adapters. Allowing a source's text to share an instruction or tool-execution context would let prompt injection cross the boundary from information being evaluated into control of the system.
