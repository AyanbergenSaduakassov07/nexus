# Nexus

Nexus is a workspace for browsing pipeline runs, datasets, and directed data lineage. The overview, job inventory, dataset catalog, and event stream read live OpenLineage metadata from Marquez.

## Run locally

Start the Docker Compose stack and run the smoke test. The stack includes the Nexus UI, Marquez API, and PostgreSQL. [Setup guide](audit/runtime/README.md) · [Local workspace](http://127.0.0.1:13000/)

## Source

- [Nexus workspace](apps/web/)
- [Marquez backend and original source](upstream/marquez/)
- [Business impact, health scoring, and investigation roadmap](docs/nexus-design.md)

Nexus builds on Marquez 0.51.1, © the Marquez project contributors, under Apache-2.0. [Upstream license](upstream/marquez/LICENSE) · [Audit and provenance](docs/upstream-audit.md)
