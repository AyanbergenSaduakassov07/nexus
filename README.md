<div align="center">

<img src="apps/web/public/favicon.svg" width="64" height="64" alt="Nexus logo">

# Nexus

**See what breaks before your stakeholders do.**

A data-lineage and pipeline-operations workspace built on the open-source [Marquez](https://marquezproject.ai) metadata server and the [OpenLineage](https://openlineage.io) standard.

**English** · [Русский](README.ru.md)

![OpenLineage](https://img.shields.io/badge/OpenLineage-2--0--2-2563eb)
![Marquez](https://img.shields.io/badge/Marquez-0.51.1-06b6d4)
![No build step](https://img.shields.io/badge/frontend-zero%20dependencies-22c55e)
![i18n](https://img.shields.io/badge/UI-EN%20%7C%20RU-f59e0b)

<img src="docs/images/overview-en.png" alt="Nexus operations overview" width="900">

</div>

---

## Contents

- [Why Nexus](#why-nexus)
- [What sets it apart](#what-sets-it-apart)
- [Screenshots](#screenshots)
- [Architecture](#architecture)
- [Demo data: the real Olist dataset](#demo-data-the-real-olist-dataset)
- [How the health score works](#how-the-health-score-works)
- [Quick start](#quick-start)
- [Project structure](#project-structure)
- [Testing](#testing)
- [Security](#security)
- [Roadmap](#roadmap)
- [Credits and licenses](#credits-and-licenses)

## Why Nexus

When a nightly job fails, a data team needs answers to three questions within minutes:

1. **What failed?**
2. **What depends on it?** This means every downstream dataset, job and dashboard.
3. **Who will notice?** This means which business reports are now stale or wrong.

Marquez already collects the lineage metadata that holds these answers. Its stock UI is built for metadata engineers, though, and not for the on-call analyst. Nexus is a focused, read-only workspace on the same API. It answers all three questions on a single screen, in English or Russian.

## What sets it apart

| | Capability | What you get |
|---|---|---|
| 💥 | **Blast radius** | Every failed job shows how many downstream jobs and datasets it reaches, and names the business reports at risk. |
| ❤️ | **Explainable health score** | Each job gets a score from 0 to 100, computed from its last 10 runs. The formula is printed in the UI. |
| 🚨 | **Incident feed** | The overview opens with active incidents, ranked by blast radius, instead of a table of raw records. |
| 🕸️ | **Impact-aware lineage graph** | Failed nodes are red, the impact zone is amber, and the selected node is outlined. Fit to width shows the whole pipeline at once. |
| 📤 | **Export to Mermaid or SVG** | One click copies the lineage as Mermaid for a pull request or wiki, or downloads it as a self-contained SVG. |
| 🌐 | **Bilingual UI** | A full English and Russian interface with a one-click switch that is remembered. A test ensures every key is translated. |
| 🔒 | **Read-only by design** | The web proxy allows only `GET`. Nexus cannot change your metadata. |
| 🪶 | **Zero dependencies** | Vanilla ES modules with no bundler and no `node_modules`. The whole UI is about 1,100 lines and loads instantly. |
| 📊 | **Real data** | The demo uses the schema of the public Olist e-commerce dataset (100k orders), not toy `foo`/`bar` tables. |

## Screenshots

<table>
<tr>
<td width="50%"><b>Lineage with blast radius</b><br><img src="docs/images/lineage-en.png" alt="Lineage graph"></td>
<td width="50%"><b>Job inventory with health and run history</b><br><img src="docs/images/jobs-en.png" alt="Jobs page"></td>
</tr>
<tr>
<td><b>Russian interface</b><br><img src="docs/images/overview-ru.png" alt="Russian overview"></td>
<td><b>Responsive down to phone width</b><br><img src="docs/images/mobile-en.png" alt="Mobile view" width="260"></td>
</tr>
</table>

## Architecture

```mermaid
flowchart LR
    subgraph Producers["Pipeline producers"]
        A[Airflow / dbt / Spark]
        S[demo/seed.py<br/>Olist pipeline]
    end

    subgraph Stack["Docker Compose · loopback only"]
        direction LR
        W["NGINX<br/>:13000<br/>static UI + GET-only proxy"]
        M["Marquez API<br/>:15000"]
        D[("PostgreSQL 17")]
    end

    B["Browser<br/>Nexus SPA<br/>(ES modules)"]

    A -- "OpenLineage events<br/>POST /api/v1/lineage" --> M
    S -- "OpenLineage events" --> M
    M <--> D
    B -- "GET /api/v1/*" --> W
    W -- "proxy (GET only)" --> M
    W -. "405 on POST/PUT/DELETE" .-x B
```

**Design choices**

- **The backend is not forked.** Marquez runs unmodified from a digest-pinned image, so Nexus is a pure UI layer.
- **Analysis runs in the client.** Health, blast radius and daily outcomes are pure functions in `model.js`. They run on data from standard Marquez endpoints and are unit-tested in Node.
- **There is no build step.** The browser loads `nexus.js`, `model.js`, `charts.js` and `i18n.js` directly. NGINX sends `Cache-Control: no-cache`, so a deploy never mixes old and new modules.

### Request flow for the lineage page

```mermaid
sequenceDiagram
    actor U as Analyst
    participant N as Nexus (browser)
    participant X as NGINX proxy
    participant M as Marquez API

    U->>N: Open #lineage?kind=job&name=extract_payments
    N->>X: GET /api/v1/lineage?nodeId=job:ingestion:extract_payments&depth=20
    X->>M: forward (GET allowed)
    M-->>N: nodes + edges
    N->>X: GET /api/v1/namespaces/ingestion/jobs/extract_payments/runs
    M-->>N: last runs
    Note over N: model.js<br/>blastRadius() → BFS downstream<br/>healthScore() → last 10 runs
    N-->>U: Graph (failed = red, impact = amber),<br/>reports at risk, health 63
```

### Frontend modules

```mermaid
flowchart TB
    nexus["nexus.js<br/>router · pages · DOM"] --> model["model.js<br/>health · blast radius · Mermaid"]
    nexus --> charts["charts.js<br/>SVG graph · bars · run strips"]
    nexus --> i18n["i18n.js<br/>EN / RU dictionary"]
    test["test/model.test.js<br/>node:test"] --> model
    test --> i18n
```

## Demo data: the real Olist dataset

The demo pipeline models the [Brazilian E-Commerce Public Dataset by Olist](https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce). It holds about 100k real orders from 2016–2018, released under CC BY-NC-SA 4.0. Table names, columns and row counts match the published dataset. **Nexus uses only this metadata and redistributes no rows.** Run history is synthetic and deterministic (seed 7), and it includes two realistic failure patterns.

```mermaid
flowchart LR
    classDef job fill:#eff6ff,stroke:#2563eb,color:#1e3a8a
    classDef fail fill:#fef2f2,stroke:#dc2626,color:#991b1b
    classDef report fill:#fffbeb,stroke:#d97706,color:#92400e

    subgraph ingestion
        eo[extract_orders]:::job
        ep[extract_payments]:::fail
        er[extract_reviews]:::job
        ec[extract_customers]:::job
        ek[extract_catalog]:::job
    end
    subgraph analytics
        so[stg_orders]:::job
        si[stg_order_items]:::job
        sp[stg_payments]:::job
        fs[fct_sales]:::job
        ds[dim_sellers]:::job
        dp[delivery_performance]:::job
        rs[review_scores]:::fail
    end
    subgraph reporting
        mr[(report.monthly_revenue)]:::report
        sc[(report.seller_scorecard)]:::report
        ld[(report.logistics_dashboard)]:::report
    end

    eo --> so & si
    ec --> so & ds
    ek --> si & ds
    ep --> sp
    so --> fs & dp
    si --> fs & rs
    sp --> fs
    er --> rs
    fs --> mr & sc
    ds --> sc
    rs --> sc
    dp --> ld
```

*This is a job-level view (intermediate datasets are omitted). Red jobs are the two failing in the demo. The `extract_payments` failure reaches **9** downstream nodes and puts **2** business reports at risk.*

| Layer | Namespace | Jobs | Example output |
|---|---|---|---|
| Ingestion | `ingestion` | 5 | `raw.orders` with 99,441 rows |
| Transform | `analytics` | 7 | `mart.fct_sales` |
| Reporting | `reporting` | 3 | `report.seller_scorecard` |

## How the health score works

```
health = 70 × (successful runs ÷ last 10 runs)  +  30 × (latest run succeeded ? 1 : 0)
```

| Band | Score | Meaning |
|---|---|---|
| 🟢 Healthy | 85–100 | Reliable, and the latest run passed |
| 🟠 Watch | 60–84 | Flaky history or a fresh failure |
| 🔴 At risk | below 60 | Repeated failures, or failing right now |

Two terms make the score explainable. A single failure today costs 30 points straight away, so it shows up. A chronically flaky job stays low even after one green run. Both terms are printed under the health chart, so no one has to guess where a number came from.

**Blast radius** is a breadth-first search over lineage edges, downstream of the failed node. Every dataset in the `report.*` layer that it reaches is listed as a *business output at risk*.

## Quick start

**Requirements:** Docker with Compose v2, Python 3.11+ and OpenSSL. On Apple Silicon, use OrbStack or Docker Desktop with AMD64 emulation.

```sh
git clone <this repo> nexus && cd nexus/audit/runtime

# 1. Create a local database password once
[ -e .env ] || (umask 077; printf 'NEXUS_MARQUEZ_DB_PASSWORD=%s\n' "$(openssl rand -hex 32)" > .env)

# 2. Start Marquez, PostgreSQL and the Nexus UI
docker compose up --detach --wait --wait-timeout 180

# 3. Load the Olist demo pipeline (14 days of runs; safe to re-run)
cd ../.. && python3 demo/seed.py

# 4. Open the workspace
open http://127.0.0.1:13000
```

| Surface | Address |
|---|---|
| Nexus workspace | http://127.0.0.1:13000 |
| Marquez REST API | http://127.0.0.1:15000/api/v1/namespaces |
| Admin health | http://127.0.0.1:15001/healthcheck |

To connect a real pipeline, point any OpenLineage integration (Airflow, dbt, Spark or Flink) at `http://127.0.0.1:15000`. Nexus picks up the events on the next page load. See the [runtime guide](audit/runtime/README.md) for stop and resume steps and for diagnostics.

## Project structure

```
nexus/
├── apps/web/
│   ├── public/
│   │   ├── index.html      # app shell
│   │   ├── nexus.js        # router, pages, DOM helpers
│   │   ├── model.js        # pure analysis: health, blast radius, Mermaid export
│   │   ├── charts.js       # SVG lineage graph, bar charts, run strips
│   │   ├── i18n.js         # English and Russian dictionaries
│   │   └── nexus.css       # white, Streamlit-style design system
│   ├── test/model.test.js  # node:test unit tests
│   └── default.conf        # NGINX: CSP, GET-only proxy, no-cache
├── demo/seed.py            # Olist pipeline → OpenLineage events
├── audit/runtime/          # Docker Compose stack and smoke test
├── docs/                   # design roadmap, upstream audit, screenshots
└── upstream/marquez/       # Marquez 0.51.1 source (Apache-2.0)
```

## Testing

```sh
cd apps/web && npm test          # 9 unit tests: health, blast radius, Mermaid, i18n coverage
python3 audit/runtime/smoke.py   # live stack: DB health, UI shell, write rejection, lineage edges
```

The unit tests need nothing beyond Node 18+. The smoke test checks against the running stack that the proxy rejects writes and that exact directed lineage edges come back through it.

## Security

- **Strict CSP**: `default-src 'self'`, with no inline scripts, no inline styles and no third-party origins.
- **GET-only proxy**: `limit_except GET { deny all; }` blocks every metadata write from the browser.
- **Loopback binding**: all ports are published on `127.0.0.1` only, and PostgreSQL has no host port.
- **No secrets in the repo**: the database password is generated into a git-ignored `.env` with mode `600`.
- **Safe rendering**: all DOM is built with `textContent` and `createElement`. Nexus never uses `innerHTML` with API data.

## Roadmap

- [x] Lineage graph with impact highlighting
- [x] Blast radius and business outputs at risk
- [x] Explainable health score
- [x] Mermaid and SVG export
- [x] English and Russian UI
- [x] Real-world demo dataset (Olist)
- [ ] Column-level lineage view (`/column-lineage`)
- [ ] Ownership and SLA facets on business outputs
- [ ] Evidence-grounded investigation copilot (see [design doc](docs/nexus-design.md))
- [ ] Slack and Telegram incident notifications

## Credits and licenses

- **Marquez** 0.51.1 is © the Marquez project contributors, under [Apache-2.0](upstream/marquez/LICENSE). See the [upstream audit](docs/upstream-audit.md).
- **OpenLineage** is an LF AI & Data project.
- **Olist dataset** is © Olist, under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). Only schema metadata is used.

<div align="center"><sub>Built by Ayanbergen Saduakassov</sub></div>
