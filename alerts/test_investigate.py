"""Unit tests for alerts/investigate.py: python -m unittest discover alerts"""

import io
import json
import unittest
from datetime import UTC, datetime
from unittest import mock

import investigate


def node(node_id: str, outs: list[str], state: str | None = None) -> dict:
    data = {"latestRun": {"state": state}} if state else {}
    edges = [{"origin": node_id, "destination": o} for o in outs]
    return {"id": node_id, "data": data, "outEdges": edges}


GRAPH = [
    node("job:ing:extract", ["dataset:ing:raw"], "FAILED"),
    node("dataset:ing:raw", ["job:an:model"]),
    node("job:an:model", ["dataset:an:mart"], "FAILED"),
    node("dataset:an:mart", ["job:rp:publish"]),
    node("job:rp:publish", ["dataset:rp:report"], "COMPLETED"),
    node("dataset:rp:report", []),
]
RUNS = [
    {"state": "FAILED", "endedAt": "2026-11-25T02:00:00+00:00"},
    {"state": "COMPLETED", "endedAt": "2026-11-24T02:00:00+00:00"},
]
DATASETS = {
    "dataset:ing:raw": {
        "facets": {
            "dataQualityAssertions": {
                "assertions": [
                    {"assertion": "not_null", "column": "id", "success": False}
                ]
            }
        }
    },
    "dataset:rp:report": {
        "namespace": "rp",
        "name": "report",
        "facets": {"sla": {"maxAgeHours": 24}},
        "lastSuccess": "2026-11-24T00:00:00+00:00",
    },
}
NOW = datetime(2026, 11, 25, 12, tzinfo=UTC)


class EvidenceTest(unittest.TestCase):
    def test_evidence_covers_cause_impact_and_owners_with_ids(self):
        evidence = investigate.build_evidence(
            "job:an:model", GRAPH, RUNS, DATASETS, ["team:finance"], NOW
        )
        self.assertEqual(
            [eid for eid, _ in evidence], ["E1", "E2", "E3", "E4", "E5", "E6", "E7"]
        )
        text = investigate.render(evidence)
        self.assertIn("[E1] Job model latest run FAILED", text)
        self.assertIn("last success: 2026-11-24T02:00:00+00:00", text)
        self.assertIn("Upstream job extract latest run FAILED.", text)
        self.assertIn("0 of 1 upstream jobs last completed fine.", text)
        self.assertIn(
            "Input raw failed data-quality check not_null on column id.", text
        )
        self.assertIn("business outputs: report.", text)
        self.assertIn("report: last refreshed 36h ago, SLA 24h.", text)
        self.assertIn("team:finance", text)

    def test_ask_model_sends_evidence_and_returns_text(self):
        reply = io.BytesIO(
            json.dumps(
                {
                    "model": "m:free",
                    "choices": [{"message": {"content": "Root cause [E2]"}}],
                }
            ).encode()
        )
        with mock.patch.object(investigate, "urlopen", return_value=reply) as call:
            note = investigate.ask_model("an", "model", [("E1", "fact one")], "k")
        self.assertEqual(note, "(m:free)\nRoot cause [E2]")
        request = call.call_args.args[0]
        self.assertEqual(request.get_header("Authorization"), "Bearer k")
        body = json.loads(request.data)
        self.assertEqual(body["model"], "openrouter/free")
        self.assertIn("evidence ids", body["messages"][0]["content"])
        self.assertIn("[E1] fact one", body["messages"][1]["content"])

    def test_ask_model_raises_on_empty_reply(self):
        reply = io.BytesIO(b'{"choices": []}')
        with mock.patch.object(investigate, "urlopen", return_value=reply):
            with self.assertRaises(RuntimeError):
                investigate.ask_model("an", "model", [], "k")


if __name__ == "__main__":
    unittest.main()
