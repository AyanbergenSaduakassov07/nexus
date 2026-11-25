# Nexus on Apple Silicon

This loopback installation serves Nexus through NGINX and runs the Marquez 0.51.1 API with PostgreSQL 17.12. The API runs through AMD64 emulation. NGINX and PostgreSQL run natively on ARM64. The three images are pinned by digest.

| Surface | Local address |
|---|---|
| Nexus workspace | [127.0.0.1:13000](http://127.0.0.1:13000/) |
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

To load the Olist demo pipeline (15 jobs, 19 datasets, 14 days of runs), run `python3 ../../demo/seed.py`. Re-running it is safe.

The smoke test checks database health, the Nexus web shell, and write rejection through the web proxy. It ingests `START` and `COMPLETE` events for two jobs via the API port and reads the four directed edges in the `orders → transform_sales → net_sales → publish_close → close_report` path through the web proxy. Each invocation creates a fresh synthetic namespace for the catalog and event stream.

## Stop, resume, and diagnose

```sh
docker compose stop
docker compose up --detach --wait --wait-timeout 180
docker compose ps
```

An ordered stop and start preserves the existing named volume and waits for healthy dependencies. A plain `docker compose restart` briefly produced closed database connections in Marquez when PostgreSQL restarted after the API. If health fails, run `docker compose logs --tail 80 db api web`. Keep the original `.env` for the lifetime of its database volume.

## Original baseline

| Check | Result on the audit Mac |
|---|---|
| Schema and readiness | 91 migrations applied to schema version 74. All three services reported healthy. |
| Smoke assertions | 2 passed. Exact directed lineage verified through the web proxy. |
| Paginated job I/O | `limit=1` returned two distinct jobs over offsets 0 and 1 with `totalCount=2` and explicit input and output IDs. |
| Persistence | Ordered stop and start was healthy in 10 seconds with images cached. Both pre-existing smoke namespaces remained. |
| Memory | Two Docker snapshots measured about 478–513 MiB combined across API, database and web. Sum of configured limits is 2,432 MiB. The VM and other running containers are outside these figures. |
| Browser | DataOps and metadata requests loaded in the healthy stack. The upstream release showed two missing icon assets and font decoding warnings. Requests that overlapped the plain restart also failed. |

These checks were recorded with the original Marquez UI. The Nexus workspace serves its own static files through NGINX. Flyway 8.5.13 warns that PostgreSQL 17.12 exceeds its tested range. Review the [roadmap](../../docs/nexus-design.md) before production deployment. [Upstream audit](../../docs/upstream-audit.md)
