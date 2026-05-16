# Project Guidelines

## Repository Layout

- The `resources/` directory is a symbolic link to a folder outside this repository.
- Treat files under `resources/` as development reference material or bundled sample data, not as the primary implementation surface.
- Do not edit `resources/` unless the user explicitly asks for a change there.
- Prefer changing project-owned files such as `src/`, `media/`, `README.md`, and workspace configuration for normal feature work and fixes.
- When investigating behavior that touches both code and sample data, confirm whether `resources/` is only reference data before editing it.