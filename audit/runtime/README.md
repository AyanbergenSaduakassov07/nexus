# Marquez on Apple Silicon

This loopback reference installation runs Marquez 0.51.1 with PostgreSQL 17.12. On the 16 GB Apple Silicon audit machine, OrbStack provided a Linux ARM64 Docker engine with about 7.8 GiB assigned to the VM. Published Marquez API and web images run as Linux AMD64 through emulation. PostgreSQL runs natively. The three images are pinned by digest.

| Surface | Local address |
|---|---|
| Original Marquez web UI | [127.0.0.1:13000](http://127.0.0.1:13000/) |
| REST API | [127.0.0.1:15000/api/v1/namespaces](http://127.0.0.1:15000/api/v1/namespaces) |
| Admin health | [127.0.0.1:15001/healthcheck](http://127.0.0.1:15001/healthcheck) |

The ports avoid macOS's existing listener on 5000. Compose publishes them on IPv4 loopback. PostgreSQL has no published host port and uses the project's private Docker network and named volume. The audit profile disables OpenSearch and GraphQL. Use synthetic data with this profile.

## Start and verify

Use OrbStack or an Apple Silicon Docker engine with AMD64 emulation, Docker Compose v2 or later, OpenSSL, and Python 3.11 or later. From the Nexus workspace root, run these commands. `orbctl start` applies to OrbStack.

```sh
orbctl start
cd audit/runtime

if [ ! -e .env ]; then
  (
    umask 077
    printf 'NEXUS_MARQUEZ_DB_PASSWORD=%s\n' "$(openssl rand -hex 32)" > .env
  )
fi

docker compose config --quiet
docker compose up --detach --wait --wait-timeout 180
python3 smoke.py
```

The smoke test checks the database health and served HTML, then ingests `START` and `COMPLETE` events for each of two jobs in a new synthetic namespace. It reads the completed runs from the API and verifies all four directed edges in the five-node `orders → transform_sales → net_sales → publish_close → close_report` path through the upstream web proxy. Each invocation creates a fresh test namespace. The browser homepage and its stats and catalog requests were also checked during the audit.

## Stop, resume, and diagnose

```sh
docker compose stop
docker compose up --detach --wait --wait-timeout 180
docker compose ps
```

An ordered stop and start preserves the existing named volume and waits for healthy dependencies. A plain `docker compose restart` briefly produced closed database connections in Marquez when PostgreSQL restarted after the API. If health fails, run `docker compose logs --tail 80 db api web`. Keep the original `.env` for the lifetime of its database volume.

## Observed results

| Check | Result on the audit Mac |
|---|---|
| Schema and readiness | 91 migrations applied to schema version 74. All three services reported healthy. |
| Smoke assertions | 2 passed. Exact directed lineage verified through the web proxy. |
| Paginated job I/O | `limit=1` returned two distinct jobs over offsets 0 and 1 with `totalCount=2` and explicit input and output IDs. |
| Persistence | Ordered stop and start was healthy in 10 seconds with images cached. Both pre-existing smoke namespaces remained. |
| Memory | Two Docker snapshots measured about 478–513 MiB combined across API, database and web. Sum of configured limits is 2,432 MiB. The VM and other running containers are outside these figures. |
| Browser | DataOps and metadata requests loaded in the healthy stack. The upstream release showed two missing icon assets and font decoding warnings. Requests that overlapped the plain restart also failed. |

Flyway 8.5.13 warns that PostgreSQL 17.12 exceeds its tested range. The old upstream Node 18 UI image is for local reference. Production dependencies, migrations, load behavior, recovery and artifact licenses require the gates in the [Nexus roadmap](../../docs/nexus-design.md). Upstream attribution and release risk are recorded in the [repository audit](../../docs/upstream-audit.md).
