"""Load the Olist e-commerce pipeline into Marquez as OpenLineage events.

Tables, columns and row counts come from the public "Brazilian E-Commerce Public
Dataset by Olist" (Kaggle, CC BY-NC-SA 4.0). Only metadata is used; no rows are
redistributed. Run history (times, durations, failures) is synthetic and deterministic.

Usage: python3 demo/seed.py [--api http://127.0.0.1:15000/api/v1] [--days 14]
Re-running is safe: run IDs and outcomes derive from (job, day), so runs keep their state.
Runs Marquez already holds as finished are skipped, so re-runs add no duplicate events.
Exception: the forced failures in FORCED_TODAY apply to today's run only.
"""

import argparse
import json
import logging
import random
from datetime import UTC, datetime, timedelta
from http import HTTPStatus
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import NAMESPACE_URL, uuid5

LOG = logging.getLogger("nexus.demo")
PRODUCER = "https://github.com/AyanbergenSaduakassov07/nexus/tree/main/demo"
RUN_SCHEMA = "https://openlineage.io/spec/2-0-2/OpenLineage.json#/$defs/RunEvent"
FACET = "https://openlineage.io/spec/facets/1-0-1/{}.json"
SOURCE_URL = "https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce"
SEED = 7

# Source tables: published name, row count (dataset v2), real columns.
SOURCES = {
    "raw.orders": (
        "olist_orders_dataset",
        99_441,
        [
            "order_id",
            "customer_id",
            "order_status",
            "order_purchase_timestamp",
            "order_approved_at",
            "order_delivered_carrier_date",
            "order_delivered_customer_date",
            "order_estimated_delivery_date",
        ],
    ),
    "raw.order_items": (
        "olist_order_items_dataset",
        112_650,
        [
            "order_id",
            "order_item_id",
            "product_id",
            "seller_id",
            "shipping_limit_date",
            "price",
            "freight_value",
        ],
    ),
    "raw.order_payments": (
        "olist_order_payments_dataset",
        103_886,
        [
            "order_id",
            "payment_sequential",
            "payment_type",
            "payment_installments",
            "payment_value",
        ],
    ),
    "raw.order_reviews": (
        "olist_order_reviews_dataset",
        99_224,
        [
            "review_id",
            "order_id",
            "review_score",
            "review_comment_title",
            "review_comment_message",
            "review_creation_date",
            "review_answer_timestamp",
        ],
    ),
    "raw.customers": (
        "olist_customers_dataset",
        99_441,
        [
            "customer_id",
            "customer_unique_id",
            "customer_zip_code_prefix",
            "customer_city",
            "customer_state",
        ],
    ),
    "raw.sellers": (
        "olist_sellers_dataset",
        3_095,
        ["seller_id", "seller_zip_code_prefix", "seller_city", "seller_state"],
    ),
    "raw.products": (
        "olist_products_dataset",
        32_951,
        [
            "product_id",
            "product_category_name",
            "product_name_lenght",
            "product_description_lenght",
            "product_photos_qty",
            "product_weight_g",
            "product_length_cm",
            "product_height_cm",
            "product_width_cm",
        ],
    ),
    "raw.geolocation": (
        "olist_geolocation_dataset",
        1_000_163,
        [
            "geolocation_zip_code_prefix",
            "geolocation_lat",
            "geolocation_lng",
            "geolocation_city",
            "geolocation_state",
        ],
    ),
    "raw.category_translation": (
        "product_category_name_translation",
        71,
        ["product_category_name", "product_category_name_english"],
    ),
}

MODELS = {
    "stg.orders": [
        "order_id",
        "customer_unique_id",
        "customer_state",
        "order_status",
        "purchased_at",
        "delivered_at",
        "estimated_at",
    ],
    "stg.order_items": [
        "order_id",
        "order_item_id",
        "product_id",
        "seller_id",
        "category_en",
        "price",
        "freight_value",
    ],
    "stg.payments": ["order_id", "payment_type", "installments", "payment_value"],
    "mart.fct_sales": [
        "order_id",
        "order_month",
        "customer_state",
        "category_en",
        "gross_value",
        "freight",
        "paid_value",
    ],
    "mart.dim_sellers": ["seller_id", "seller_state", "lat", "lng"],
    "mart.delivery_performance": [
        "order_month",
        "customer_state",
        "on_time_rate",
        "avg_delay_days",
    ],
    "mart.review_scores": ["seller_id", "order_month", "avg_score", "reviews"],
    "report.monthly_revenue": ["order_month", "gmv", "orders", "avg_ticket"],
    "report.seller_scorecard": ["seller_id", "gmv", "avg_score", "late_share"],
    "report.logistics_dashboard": ["customer_state", "on_time_rate", "avg_delay_days"],
}

# Who answers for each business output (OpenLineage ownership facet).
TEAMS = {
    "report.monthly_revenue": "team:finance",
    "report.seller_scorecard": "team:marketplace",
    "report.logistics_dashboard": "team:operations",
}

# Column lineage: output column -> ([(input dataset, input column)], transformation).
COLUMN_LINEAGE = {
    "mart.fct_sales": {
        "order_month": ([("stg.orders", "purchased_at")], "date_trunc('month', ·)"),
        "customer_state": ([("stg.orders", "customer_state")], "identity"),
        "category_en": ([("stg.order_items", "category_en")], "identity"),
        "gross_value": ([("stg.order_items", "price")], "sum"),
        "freight": ([("stg.order_items", "freight_value")], "sum"),
        "paid_value": ([("stg.payments", "payment_value")], "sum"),
    },
    "mart.delivery_performance": {
        "on_time_rate": (
            [("stg.orders", "delivered_at"), ("stg.orders", "estimated_at")],
            "share delivered by the promised date",
        ),
        "avg_delay_days": (
            [("stg.orders", "delivered_at"), ("stg.orders", "estimated_at")],
            "avg(delivered − estimated)",
        ),
    },
    "mart.review_scores": {
        "seller_id": ([("stg.order_items", "seller_id")], "identity"),
        "avg_score": ([("raw.order_reviews", "review_score")], "avg"),
        "reviews": ([("raw.order_reviews", "review_id")], "count"),
    },
    "report.monthly_revenue": {
        "order_month": ([("mart.fct_sales", "order_month")], "identity"),
        "gmv": ([("mart.fct_sales", "gross_value")], "sum"),
        "orders": ([("mart.fct_sales", "order_id")], "count distinct"),
        "avg_ticket": (
            [("mart.fct_sales", "gross_value"), ("mart.fct_sales", "order_id")],
            "gmv / orders",
        ),
    },
    "report.seller_scorecard": {
        "seller_id": ([("mart.dim_sellers", "seller_id")], "identity"),
        "gmv": ([("mart.fct_sales", "gross_value")], "sum"),
        "avg_score": ([("mart.review_scores", "avg_score")], "identity"),
    },
    "report.logistics_dashboard": {
        "on_time_rate": ([("mart.delivery_performance", "on_time_rate")], "identity"),
        "avg_delay_days": (
            [("mart.delivery_performance", "avg_delay_days")],
            "identity",
        ),
    },
}

# (namespace, job, description, inputs, outputs, failure rate, base minutes)
JOBS = [
    (
        "ingestion",
        "extract_orders",
        "Copy orders and order items from the marketplace OLTP database.",
        [],
        ["raw.orders", "raw.order_items"],
        0.03,
        6,
    ),
    (
        "ingestion",
        "extract_payments",
        "Copy payment transactions from the payments gateway.",
        [],
        ["raw.order_payments"],
        0.06,
        5,
    ),
    (
        "ingestion",
        "extract_reviews",
        "Copy customer review surveys.",
        [],
        ["raw.order_reviews"],
        0.0,
        3,
    ),
    (
        "ingestion",
        "extract_customers",
        "Copy customers and zip-code geolocation.",
        [],
        ["raw.customers", "raw.geolocation"],
        0.0,
        9,
    ),
    (
        "ingestion",
        "extract_catalog",
        "Copy products, sellers and category translations.",
        [],
        ["raw.products", "raw.sellers", "raw.category_translation"],
        0.0,
        4,
    ),
    (
        "analytics",
        "stg_orders",
        "Join orders to the real customer identity (customer_unique_id).",
        ["raw.orders", "raw.customers"],
        ["stg.orders"],
        0.0,
        8,
    ),
    (
        "analytics",
        "stg_order_items",
        "Attach English product categories to order lines.",
        ["raw.order_items", "raw.products", "raw.category_translation"],
        ["stg.order_items"],
        0.0,
        7,
    ),
    (
        "analytics",
        "stg_payments",
        "Collapse instalment rows into one payment per order.",
        ["raw.order_payments"],
        ["stg.payments"],
        0.0,
        4,
    ),
    (
        "analytics",
        "fct_sales",
        "Order-line sales fact reconciled to payments.",
        ["stg.orders", "stg.order_items", "stg.payments"],
        ["mart.fct_sales"],
        0.0,
        14,
    ),
    (
        "analytics",
        "dim_sellers",
        "Seller dimension with geocoded location.",
        ["raw.sellers", "raw.geolocation"],
        ["mart.dim_sellers"],
        0.0,
        6,
    ),
    (
        "analytics",
        "delivery_performance",
        "On-time delivery rate versus the promised date.",
        ["stg.orders"],
        ["mart.delivery_performance"],
        0.0,
        5,
    ),
    (
        "analytics",
        "review_scores",
        "Monthly review score per seller.",
        ["raw.order_reviews", "stg.order_items"],
        ["mart.review_scores"],
        0.2,
        6,
    ),
    (
        "reporting",
        "publish_monthly_revenue",
        "Monthly GMV report for finance.",
        ["mart.fct_sales"],
        ["report.monthly_revenue"],
        0.0,
        3,
    ),
    (
        "reporting",
        "publish_seller_scorecard",
        "Seller scorecard for the marketplace team.",
        ["mart.fct_sales", "mart.dim_sellers", "mart.review_scores"],
        ["report.seller_scorecard"],
        0.0,
        4,
    ),
    (
        "reporting",
        "publish_logistics_dashboard",
        "Delivery SLA dashboard for operations.",
        ["mart.delivery_performance"],
        ["report.logistics_dashboard"],
        0.0,
        3,
    ),
]

# Today's forced outcome, so the demo always has live incidents.
TERMINAL_STATES = {"COMPLETED", "FAILED", "ABORTED"}
FORCED_TODAY = {"extract_payments": "FAIL", "review_scores": "FAIL"}


def facet(name: str, **fields: object) -> dict:
    return {"_producer": PRODUCER, "_schemaURL": FACET.format(name), **fields}


def dataset_ref(name: str, owners: dict[str, str], as_output: bool) -> dict:
    ref: dict = {"namespace": owners[name], "name": name}
    if not as_output:
        return ref
    if name in SOURCES:
        table, rows, columns = SOURCES[name]
        description = (
            f"Olist public dataset: {table}.csv ({rows:,} rows). Source: {SOURCE_URL}"
        )
        ref["outputFacets"] = {
            "outputStatistics": facet(
                "OutputStatisticsOutputDatasetFacet", rowCount=rows
            )
        }
    else:
        columns = MODELS[name]
        description = f"Nexus demo model built from the Olist public dataset ({name})."
    fields = [{"name": column} for column in columns]
    ref["facets"] = {
        "schema": facet("SchemaDatasetFacet", fields=fields),
        "documentation": facet("DocumentationDatasetFacet", description=description),
    }
    if name in TEAMS:
        team = [{"name": TEAMS[name], "type": "TEAM"}]
        ref["facets"]["ownership"] = facet("OwnershipDatasetFacet", owners=team)
    if name in COLUMN_LINEAGE:
        ref["facets"]["columnLineage"] = column_lineage(COLUMN_LINEAGE[name], owners)
    return ref


def column_lineage(columns: dict, owners: dict[str, str]) -> dict:
    fields = {
        column: {
            "inputFields": [
                {"namespace": owners[dataset], "name": dataset, "field": field}
                for dataset, field in sources
            ],
            "transformationDescription": transform,
        }
        for column, (sources, transform) in columns.items()
    }
    url = "https://openlineage.io/spec/facets/1-2-0/ColumnLineageDatasetFacet.json"
    return {**facet("ColumnLineageDatasetFacet", fields=fields), "_schemaURL": url}


def post(api: str, event: dict) -> None:
    request = Request(
        f"{api}/lineage",
        data=json.dumps(event).encode(),
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urlopen(request, timeout=15) as response:
        response.read()


def run_finished(api: str, run_id: str) -> bool:
    """True when Marquez already holds this run in a terminal state."""
    try:
        with urlopen(f"{api}/jobs/runs/{run_id}", timeout=15) as response:
            state = json.loads(response.read()).get("state")
    except HTTPError as error:
        if error.code == HTTPStatus.NOT_FOUND:
            return False
        raise
    return state in TERMINAL_STATES


def build_events(days: int, now: datetime) -> list[dict]:
    owners = {out: ns for ns, _, _, _, outs, _, _ in JOBS for out in outs}
    events = []
    for day in range(days, -1, -1):
        start = (now - timedelta(days=day)).replace(
            hour=1, minute=0, second=0, microsecond=0
        )
        for order, (ns, job, doc, inputs, outputs, fail_rate, minutes) in enumerate(
            JOBS
        ):
            run_id = str(uuid5(NAMESPACE_URL, f"nexus-olist/{ns}/{job}/{start.date()}"))
            # One RNG per run, so a run keeps its outcome whichever day the seed runs.
            rng = random.Random(f"{SEED}/{ns}/{job}/{start.date()}")
            began = start + timedelta(minutes=order * 6)
            ended = began + timedelta(minutes=minutes * rng.uniform(0.7, 1.6))
            failed = rng.random() < fail_rate
            state = (
                FORCED_TODAY.get(job, "COMPLETE")
                if day == 0
                else ("FAIL" if failed else "COMPLETE")
            )
            base = {
                "producer": PRODUCER,
                "schemaURL": RUN_SCHEMA,
                "run": {"runId": run_id},
                "job": {
                    "namespace": ns,
                    "name": job,
                    "facets": {
                        "documentation": facet("DocumentationJobFacet", description=doc)
                    },
                },
                "inputs": [dataset_ref(n, owners, False) for n in inputs],
            }
            events.append(
                {
                    **base,
                    "eventType": "START",
                    "eventTime": began.isoformat(),
                    "outputs": [],
                }
            )
            events.append(
                {
                    **base,
                    "eventType": state,
                    "eventTime": ended.isoformat(),
                    "outputs": [dataset_ref(n, owners, True) for n in outputs],
                }
            )
    return events


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    parser = argparse.ArgumentParser(
        description="Load the Olist demo pipeline into Marquez."
    )
    parser.add_argument("--api", default="http://127.0.0.1:15000/api/v1")
    parser.add_argument("--days", type=int, default=14)
    args = parser.parse_args()
    if not 0 <= args.days <= 90:
        parser.error("--days must be between 0 and 90")
    events = build_events(args.days, datetime.now(UTC) - timedelta(hours=2))
    try:
        # Runs have deterministic IDs, so a re-run skips what Marquez already holds.
        finished = {
            run_id
            for run_id in {event["run"]["runId"] for event in events}
            if run_finished(args.api, run_id)
        }
        pending = [e for e in events if e["run"]["runId"] not in finished]
        for event in pending:
            post(args.api, event)
    except URLError as error:
        raise SystemExit(f"Marquez API unreachable at {args.api}: {error}") from error
    LOG.info(
        "Posted %d events for %d jobs over %d days; %d finished runs already loaded.",
        len(pending),
        len(JOBS),
        args.days + 1,
        len(finished),
    )


if __name__ == "__main__":
    main()
