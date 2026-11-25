# jaffle_shop (vendored)

Source: [dbt-labs/jaffle_shop_duckdb](https://github.com/dbt-labs/jaffle_shop_duckdb)
at commit `20cc904370818ceab08cf19f8fd196e9e81def88`, Apache License 2.0 (see `LICENSE`).

Copied: `models/`, `seeds/`, `dbt_project.yml`, `profiles.yml`.

Changed for Nexus: `models/schema.yml` adds one `not_null` test on `customers.first_order`
with `severity: warn`. It fails on purpose (some customers have no orders yet), so the
Nexus quality panel shows an advisory finding while the build stays green.
