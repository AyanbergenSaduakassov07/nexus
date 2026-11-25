#!/usr/bin/env bash
# Runs the jaffle_shop dbt project on DuckDB and sends real OpenLineage events
# (runs, lineage, schemas, dbt test results) to Marquez through dbt-ol.
# Usage: pipelines/run_dbt.sh [marquez-url]   (default http://127.0.0.1:15000)
set -euo pipefail

cd "$(dirname "$0")/jaffle_shop"
export OPENLINEAGE_URL="${1:-${OPENLINEAGE_URL:-http://127.0.0.1:15000}}"
export OPENLINEAGE_NAMESPACE="${OPENLINEAGE_NAMESPACE:-dbt}"
export DBT_PROFILES_DIR="$PWD"
export DBT_SEND_ANONYMOUS_USAGE_STATS=false

dbt-ol build
