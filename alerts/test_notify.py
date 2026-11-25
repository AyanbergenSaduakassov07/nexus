"""Unit tests for alerts/notify.py: python -m unittest discover alerts"""

import json
import tempfile
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

import notify

from notify import (
    blast_radius,
    check_alert,
    compose,
    failed_checks,
    job_alert,
    load_state,
)

# raw -> job A -> mid -> job B -> out ; mid -> job C -> side
GRAPH = [
    {
        "id": "dataset:n:raw",
        "outEdges": [{"origin": "dataset:n:raw", "destination": "job:n:A"}],
    },
    {
        "id": "job:n:A",
        "outEdges": [{"origin": "job:n:A", "destination": "dataset:n:mid"}],
    },
    {
        "id": "dataset:n:mid",
        "outEdges": [
            {"origin": "dataset:n:mid", "destination": "job:n:B"},
            {"origin": "dataset:n:mid", "destination": "job:n:C"},
        ],
    },
    {
        "id": "job:n:B",
        "outEdges": [{"origin": "job:n:B", "destination": "dataset:n:out"}],
    },
    {
        "id": "job:n:C",
        "outEdges": [{"origin": "job:n:C", "destination": "dataset:s3://b:side"}],
    },
]


class NotifyTest(unittest.TestCase):
    def test_blast_radius_matches_ui_rules(self):
        radius = blast_radius(GRAPH, "job:n:A")
        self.assertEqual(radius["jobs"], ["job:n:B", "job:n:C"])
        self.assertEqual(radius["outputs"], ["dataset:n:out", "dataset:s3://b:side"])

    def test_job_alert_lists_outputs_and_links_to_lineage(self):
        job = {
            "namespace": "n",
            "name": "A",
            "latestRun": {"id": "r1", "state": "FAILED", "endedAt": "t"},
        }
        alert = job_alert(job, blast_radius(GRAPH, "job:n:A"), "http://ui")
        self.assertEqual(alert["key"], "run:r1")
        self.assertIn("Outputs at risk: out, side", alert["text"])
        self.assertIn("http://ui/#lineage?kind=job&namespace=n&name=A", alert["text"])

    def test_only_failed_checks_alert_and_warn_is_labelled(self):
        dataset = {
            "namespace": "duckdb://x",
            "name": "main.customers",
            "facets": {
                "dataQualityAssertions": {
                    "assertions": [
                        {"name": "unique_id", "success": True},
                        {
                            "name": "nn_first",
                            "column": "first",
                            "success": False,
                            "severity": "warn",
                            "actual": "38",
                        },
                    ]
                }
            },
        }
        checks = failed_checks(dataset)
        self.assertEqual(len(checks), 1)
        text = check_alert(dataset, checks[0])["text"]
        self.assertEqual(
            text, "⚠ main.customers: nn_first (first) failed on 38 rows [warn]"
        )
        self.assertEqual(failed_checks({"facets": None}), [])

    def test_compose_counts_kinds(self):
        title, _ = compose(
            [
                {"kind": "job", "text": "a"},
                {"kind": "check", "text": "b"},
                {"kind": "check", "text": "c"},
            ]
        )
        self.assertEqual(title, "Nexus: 1 failing job, 2 failed checks")

    def test_state_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "state.json"
            self.assertEqual(load_state(path), set())
            path.write_text(json.dumps(["run:r1"]))
            self.assertEqual(load_state(path), {"run:r1"})

    def test_check_that_recovers_and_fails_again_alerts_again(self):
        check = {"key": "check:k", "kind": "check", "text": "x"}
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp) / "state.json"
            argv = ["notify.py", "--state", str(state)]
            env = {"NEXUS_ALERT_URLS": "json://localhost"}
            with (
                mock.patch.object(sys, "argv", argv),
                mock.patch.dict(os.environ, env),
                mock.patch.object(notify, "send", return_value=True) as send,
            ):
                for current in ([check], [], [check]):  # fail, recover, fail again
                    with mock.patch.object(notify, "collect", return_value=current):
                        self.assertEqual(notify.main(), 0)
            self.assertEqual(send.call_count, 2)

    def test_owners_are_listed_and_a_failed_lookup_is_skipped(self):
        def fake_get(api, path):
            if "out" in path:
                return {"facets": {"ownership": {"owners": [{"name": "team:finance"}]}}}
            raise OSError("404")

        with mock.patch.object(notify, "get_json", side_effect=fake_get):
            owners = notify.owners_of(
                "http://api", ["dataset:n:out", "dataset:s3://b:side"]
            )
        self.assertEqual(owners, ["team:finance"])
        job = {
            "namespace": "n",
            "name": "A",
            "latestRun": {"id": "r1", "state": "FAILED"},
        }
        text = job_alert(
            job, blast_radius(GRAPH, "job:n:A"), "http://ui", ("team:finance",)
        )["text"]
        self.assertIn("Owners: team:finance", text)
        self.assertIn("unknown time", text)

    def test_stale_alert_only_past_the_sla(self):
        now = notify.datetime(2026, 11, 25, 12, tzinfo=notify.UTC)
        dataset = {
            "namespace": "r",
            "name": "report.x",
            "facets": {"sla": {"maxAgeHours": 24}},
        }
        self.assertIsNone(notify.stale_alert(dataset, "2026-11-25T00:00:00Z", now))
        late = notify.stale_alert(dataset, "2026-11-24T02:00:00Z", now)
        self.assertEqual(late["text"], "⏱ report.x: last refreshed 34h ago, SLA 24h")
        self.assertIn("never refreshed", notify.stale_alert(dataset, None, now)["text"])
        self.assertIsNone(notify.stale_alert({**dataset, "facets": {}}, None, now))
        title, _ = notify.compose([late])
        self.assertEqual(
            title, "Nexus: 0 failing jobs, 0 failed checks, 1 stale report"
        )

    def test_corrupt_state_is_ignored(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "state.json"
            path.write_text('["run:r1"')
            self.assertEqual(load_state(path), set())


if __name__ == "__main__":
    unittest.main()
