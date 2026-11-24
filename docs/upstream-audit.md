# Marquez upstream audit

**Recommendation.** Use Marquez 0.51.1 for the local reference installation. Keep the backend intact behind Nexus's typed HTTP adapter. Qualify the production build with supported runtime dependencies and upstream contract tests.

## Baseline and scope

| Reference | Revision | Role |
|---|---|---|
| Release tag `0.51.1` | `27a4a1357d9078bc4e6738524dfe5ba9d77aa2df` | Reference runtime and compatibility contract. The tag, chart, and OCI images exist. |
| Upstream `main`, observed 2026-11-24 | `180f37b22387146187af1ef0279e3ee1d1ccd789` | Source audit and candidate fixes. Six commits beyond 0.51.1, including React 19 and a jobs-query performance fix. The tree identifies itself as `0.51.2-SNAPSHOT`. |
| Release tag `0.50.0` | `4984ca939b3a6f59e1092c6397702eb1e53ff1cc` | Release marked latest on GitHub at audit time. |

The full Git checkout includes history and tags. Each audited tree contains 976 tracked files. The review covered the complete top-level inventory, the operating configuration and dependency manifests, and selected implementation and test paths for ingestion, lineage, web, and storage. The main tree was indexed at Tier 2, with direct source reads for key call paths, SQL semantics, and flagged Gradle and migration coverage. Runtime tests use the published 0.51.1 image and the release's API contract. [Release source](https://github.com/MarquezProject/marquez/tree/27a4a1357d9078bc4e6738524dfe5ba9d77aa2df) · [Main snapshot](https://github.com/MarquezProject/marquez/tree/180f37b22387146187af1ef0279e3ee1d1ccd789) · [GitHub release](https://github.com/MarquezProject/marquez/releases/tag/0.50.0) · [Registry tags](https://hub.docker.com/r/marquezproject/marquez/tags)

## Repository and reuse

| Upstream area | Existing behavior | Nexus disposition |
|---|---|---|
| `api/` and `spec/` | Dropwizard HTTP resources, OpenLineage ingestion, namespaces, sources, datasets, fields and tags, jobs, job and dataset versions, runs and facets, dataset and column lineage, upstream run lineage, event summaries, search, health and Prometheus metrics. | Run the upstream backend as supplied. Use the versioned REST interface and normal OpenLineage ingestion. Preserve API behavior. |
| `api/src/main/resources/marquez/db/migration/`, `api/…/db/` | PostgreSQL schema, current-version I/O mappings, historical versions and run metadata, raw lineage events, Flyway migrations, optional retention. | Keep Marquez as the metadata system of record. Its migrations and database remain under its ownership. |
| `web/` | React application with DataOps, jobs, datasets, events, graphs, and Express proxy. | Use the original UI for baseline comparison and diagnostics. Ship the Nexus workspace for business impact and incident investigations. |
| `web/libs/graph/` | Private React graph renderer, ELK layout worker, pan/zoom and minimap. Custom node rendering is supported. | Evaluate unmodified layout/renderer reuse with a small compatibility check. Its React 18 and Chakra 2 peers may outweigh the reuse benefit on the proposed React 19 UI. |
| `clients/java/`, `clients/python/` | Published Marquez API clients with their own packaging and tests. | Keep upstream clients available to existing callers. New producers speak OpenLineage and the Nexus adapter uses server-side HTTP. |
| `examples/`, `dev/`, `proposals/`, `stats/`, `docs/` | Airflow example and screenshots, dev helpers, design proposals, statistics tooling, Docusaurus website and tutorials. | Use these as references and retain original files in the upstream checkout. The Nexus demo runs original fixtures and real sample SQL transformations. |
| `docker/`, `Dockerfile`, Compose files, `chart/`, `gradle/` | Release and dev containers, initialization, seed and maintenance CLI, Kubernetes chart, Gradle wrapper. | Keep release images pinned for the reference runtime. Use Nexus deployment manifests, supported database versions and explicit readiness checks. |
| `.circleci/`, `.github/`, project and governance files | Upstream Java, web and Python checks, docs builds, chart and source-header workflows, DCO and contribution guidance. | Preserve upstream workflows in the source pin. Add Nexus CI for its contracts, services, UI and delivery artifacts. |

[Source tree and contribution files](https://github.com/MarquezProject/marquez/tree/0.51.1) · [REST specification](https://github.com/MarquezProject/marquez/blob/0.51.1/spec/openapi.yml) · [Deployment overview](https://marquezproject.ai/docs/deployment/)

## Data flow and integration boundaries

1. The OpenLineage resource receives events at `POST /api/v1/lineage`. The service persists raw events and updates the metadata projection through the DAO layer. Event storage and projection updates have distinct asynchronous operations. A failed request or a retry can require reconciliation.
2. PostgreSQL stores modeled datasets, job versions and I/O, runs, and facets. The lineage route builds a neighborhood using current job-version I/O. Its depth applies to the backend's job-neighborhood query. Dataset lookup selects a single associated job as the starting point. Each graph edge carries a directed origin and destination. A bounded neighborhood can omit other consumers, and current topology can change after an incident.
3. Use the lineage, column-lineage, run, dataset/version, and job/version endpoints for their respective domains. The raw events endpoint is a global time-window page. Run context can use the run-specific metadata and facets endpoints. Validate the JSON contract against the published image as well as the OpenAPI document. Establish which dataset-version or partition evidence each producer supplies during adapter qualification. The 0.51.1 UI already displays OpenLineage event counts, run states, durations, facets and data quality assertions. These are inherited capabilities.
4. Keep API and admin endpoints behind a controlled network boundary. Marquez HTTP has no default authorization enforcement. Expose a separate authenticated ingestion route for producers and enforce viewing permissions in Nexus. OpenSearch is an optional dependency for advanced search. The verified baseline disables OpenSearch and beta GraphQL.

[Ingestion resource](https://github.com/MarquezProject/marquez/blob/0.51.1/api/src/main/java/marquez/api/OpenLineageResource.java) · [Ingestion service](https://github.com/MarquezProject/marquez/blob/0.51.1/api/src/main/java/marquez/service/OpenLineageService.java) · [Lineage query](https://github.com/MarquezProject/marquez/blob/0.51.1/api/src/main/java/marquez/db/LineageDao.java) · [0.50.0 observability release notes](https://github.com/MarquezProject/marquez/releases/tag/0.50.0)

## Dependency assessment

| Surface | Audited baseline | Decision |
|---|---|---|
| API build and runtime | Java 17, Gradle 8.7, Dropwizard 2.1.12, JDBI 3.40.0, Flyway 8.5.13, PostgreSQL JDBC 42.7.4, OpenLineage Java 1.23.0. Jackson/Jetty via framework, Guava, GraphQL Java, Prometheus, Sentry and OpenSearch clients. Published Linux image is amd64 with Temurin 17.0.14. | Preserve Java and the service architecture. Build a pinned and patched Java 17 release candidate, resolve the dependency graph, and scan its image. Test ARM64 and AMD64 at the same source commit. |
| Metadata storage | Upstream Compose targets PostgreSQL 14, which reached end of life on 2026-11-12. The local run applied 91 migrations on native PostgreSQL 17.12. Flyway 8.5.13 flagged 17.12 as beyond its tested range. | Qualify supported PostgreSQL and Flyway versions together. Test clean install, an upgrade from a populated baseline, restore, and connection recovery before production. |
| Upstream web | 0.51.1 uses React 18, TypeScript, Webpack, MUI/Emotion, Redux/Saga, D3/ELK, i18next and Express proxy. Its image runs Node 18.20.7, an EOL Node release line. Main moves to React 19 while preserving the Node 18 container base. | Keep the upstream web image in the loopback audit profile. Use a supported Node LTS and a small locked dependency set for the Nexus UI and service. Audit any extracted graph code and its dependencies. |
| Optional search, telemetry and orchestration | OpenSearch sidecar, Prometheus metrics, optional Sentry, Helm, Airflow sample integration. | Keep Postgres-only startup. Enable additions against measured requirements. Turn external telemetry off by default. Use the customer's scheduler or OpenLineage agents in production. |
| SDKs and build/test dependencies | Java client uses Jackson/SLF4J/Apache HTTP client. Python client uses requests, six, pyrfc3339, deprecation and pytz. The API uses JUnit, Mockito and Testcontainers. The web uses Jest and Testing Library. Python uses pytest. | Retain client compatibility where tested. Use the Python standard library for demo and smoke tooling and run upstream suites when qualifying a Marquez build. |

The npm registry audit of the committed web locks on 2026-11-24, using `npm audit --package-lock-only --omit=dev --json`, returned advisory findings for **77 package entries in 0.51.1** (4 critical, 37 high) and **72 in main** (9 critical, 33 high). These are vulnerable package entries from npm's dependency analysis. Reachability and correspondence to the published web image require artifact inspection. Upstream Java and container vulnerability scans, a resolved license inventory, native Marquez image builds, the full upstream suites, and supported Postgres/Flyway qualification remain release work.

[Release build dependencies](https://github.com/MarquezProject/marquez/blob/0.51.1/build.gradle) · [API dependencies](https://github.com/MarquezProject/marquez/blob/0.51.1/api/build.gradle) · [Web lockfile](https://github.com/MarquezProject/marquez/blob/0.51.1/web/package-lock.json) · [Node.js lifecycle](https://nodejs.org/en/about/previous-releases) · [PostgreSQL 14 EOL notice](https://www.postgresql.org/about/news/postgresql-187-1712-1616-1520-1425-and-19-rc-2-released-3442/)

## Licensing and attribution

Marquez is Apache-2.0. The pinned source tree has a root `LICENSE` and contributor copyright and SPDX headers. A tracked NOTICE file did not appear in the audited source inventory. Check notices inside each redistributed image, JAR, browser bundle and dependency independently. The Karla font has a bundled SIL OFL 1.1 text. Source Code Pro binaries are also present and their applicable publisher notice and font version should be checked before redistribution. Nexus uses a distinct name, wordmark and artwork.

- Ship the Apache-2.0 license with applicable distributions. Retain applicable upstream copyright, patent, trademark and attribution notices in distributed source and reproduce required NOTICE attributions when present. Add prominent notices in each modified upstream file.
- Keep the upstream URL and source revision in this audit and pin artifact digests in the deployment configuration. Record the purpose and scope of any future patches here. Provide equivalent component provenance and third-party notices alongside release artifacts and in the UI's About view. Document which services and features were developed for Nexus.
- Generate an artifact-level SBOM and license bundle for each release. Review packages, container OS components, fonts, icons and included assets separately. Set the licensing terms for independently developed Nexus code before distributing releases outside the project.

[Pinned Marquez LICENSE](https://github.com/MarquezProject/marquez/blob/0.51.1/LICENSE) · [Apache-2.0 redistribution terms](https://www.apache.org/licenses/LICENSE-2.0.html) · [Karla license](https://github.com/MarquezProject/marquez/blob/0.51.1/web/src/fonts/Karla/OFL.txt) · [Source Code Pro publisher license](https://github.com/adobe-fonts/source-code-pro/blob/release/LICENSE.md)
