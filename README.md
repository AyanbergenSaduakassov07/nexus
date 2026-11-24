# Nexus

Nexus is an enterprise data lineage and pipeline observability project. Its goal is to help data teams find affected business outputs when a pipeline fails, assess delivery risk, and investigate incidents using evidence they can verify.

## Project status

The reference stack and lineage smoke test are ready to run on Apple Silicon. The Nexus workspace and intelligence features below are specified in the roadmap and are pending implementation.

| Capability | Scope |
|---|---|
| Lineage reference | Collect OpenLineage run events and browse jobs, datasets, metadata and directed lineage. Available in the reference stack. |
| Operations workspace | Navigate datasets, jobs, business assets and incidents. Inspect ownership, delivery objectives and the evidence behind each assessment. |
| Business impact | Trace downstream paths to affected reports, KPIs and operational applications. Distinguish potential exposure from evidenced delivery failures. |
| Health and risk | Score freshness, run reliability and quality assertions. Show weights, coverage, missing observations and any breach override. |
| Investigation copilot | Run a bounded sequence of read-only tools and cite their evidence. Preserve a replayable record of the investigation. |
| Enterprise demo | Exercise delivery failures, schema changes, quality drift and recovery with synthetic source databases and SQL transformations. |

## Run the reference stack

On Apple Silicon, use Docker Compose with AMD64 emulation, OpenSSL, and Python 3.11 or later. Start your container engine, then run the following from the repository root.

```sh
cd audit/runtime

if [ ! -e .env ]; then
  (
    umask 077
    printf 'NEXUS_MARQUEZ_DB_PASSWORD=%s\n' "$(openssl rand -hex 32)" > .env
  )
fi

docker compose up --detach --wait --wait-timeout 180
python3 smoke.py
```

Open the lineage reference UI on port 13000. The smoke test submits four OpenLineage events, verifies two completed runs and checks the four directed edges from orders to a close report. Each run creates a fresh synthetic namespace. [Local reference UI](http://127.0.0.1:13000/)

The stack was verified on a 16 GB Apple Silicon Mac. It uses pinned images and publishes the web, API and health endpoints on loopback. Follow the runbook for compatibility notes, database persistence and shutdown. [Local runbook](audit/runtime/README.md)

## Architecture

OpenLineage producers send execution metadata to the lineage backend. PostgreSQL stores jobs, dataset versions and runs. The planned Nexus API reads that metadata through a typed adapter and stores business assets, scoring policies and investigation evidence in a separate database. The planned React workspace uses the Nexus API for access-controlled views.

| Path | Contents |
|---|---|
| [audit/runtime/](audit/runtime/) | Pinned Compose configuration, local runbook and executable lineage smoke test |
| [docs/nexus-design.md](docs/nexus-design.md) | Architecture, product specifications, phased rollout and measurable acceptance criteria |
| [docs/upstream-audit.md](docs/upstream-audit.md) | Upstream inventory, dependency assessment and licensing record |

The first product milestone follows a late payments scenario from a failed run to an affected finance report. The operator can inspect the lineage path, see how the score was calculated and replay the cited investigation.

## Upstream attribution

Nexus uses Marquez, copyright its project contributors, as its OpenLineage metadata backend. The local profile pulls unmodified Marquez 0.51.1 API and web images, pinned by digest. This repository contains the Nexus project documents and reference setup. Upstream source and history are maintained by the Marquez Project under Apache-2.0. [Marquez source at the pinned revision](https://github.com/MarquezProject/marquez/tree/27a4a1357d9078bc4e6738524dfe5ba9d77aa2df) · [Upstream license](https://github.com/MarquezProject/marquez/blob/27a4a1357d9078bc4e6738524dfe5ba9d77aa2df/LICENSE)
