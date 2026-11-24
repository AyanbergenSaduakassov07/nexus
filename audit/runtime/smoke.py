"""Exercise the local Marquez API, lineage storage, and web proxy."""

import json
import unittest
from datetime import UTC, datetime, timedelta
from itertools import pairwise
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from uuid import uuid4

API = "http://127.0.0.1:15000/api/v1"
ADMIN = "http://127.0.0.1:15001"
WEB = "http://127.0.0.1:13000"
PRODUCER = "https://example.invalid/nexus/audit"
RUN_SCHEMA = "https://openlineage.io/spec/2-0-2/OpenLineage.json#/$defs/RunEvent"


def read_json(url: str, payload: dict | None = None) -> dict:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = Request(url, data=data, headers={"Content-Type": "application/json"})
    with urlopen(request, timeout=15) as response:
        return json.loads(response.read() or b"{}")


class MarquezSmokeTest(unittest.TestCase):
    def test_health_and_web_shell(self) -> None:
        checks = read_json(f"{ADMIN}/healthcheck")
        self.assertTrue(checks["postgresql"]["healthy"])
        with urlopen(WEB, timeout=15) as response:
            self.assertEqual(response.headers.get_content_type(), "text/html")
            self.assertIn(b"Marquez", response.read())

    def test_ingest_runs_and_read_directed_lineage_through_web(self) -> None:
        namespace = f"nexus-audit-{uuid4().hex[:12]}"
        started = datetime.now(UTC) - timedelta(minutes=2)
        names = ("orders", "net_sales", "close_report")
        source, mart, report = (
            {"namespace": namespace, "name": name} for name in names
        )
        jobs = (
            ("transform_sales", source, mart),
            ("publish_close", mart, report),
        )
        for index, (name, input_dataset, output_dataset) in enumerate(jobs):
            run_id = str(uuid4())
            event = {
                "producer": PRODUCER,
                "schemaURL": RUN_SCHEMA,
                "job": {"namespace": namespace, "name": name},
                "run": {"runId": run_id},
                "inputs": [input_dataset],
                "outputs": [output_dataset],
            }
            for offset, event_type in enumerate(("START", "COMPLETE")):
                observed = started + timedelta(seconds=2 * index + offset)
                read_json(
                    f"{API}/lineage",
                    {
                        **event,
                        "eventType": event_type,
                        "eventTime": observed.isoformat(),
                    },
                )
            run = read_json(f"{API}/jobs/runs/{run_id}")
            self.assertEqual((run["id"], run["state"]), (run_id, "COMPLETED"))

        node_ids = tuple(f"dataset:{namespace}:{name}" for name in names)
        job_ids = tuple(f"job:{namespace}:{job[0]}" for job in jobs)
        path = (node_ids[0], job_ids[0], node_ids[1], job_ids[1], node_ids[2])
        query = urlencode({"nodeId": path[0], "depth": 4})
        graph = read_json(f"{WEB}/api/v1/lineage?{query}")["graph"]
        edges = {
            (edge["origin"], edge["destination"])
            for node in graph
            for edge in node["outEdges"]
        }
        self.assertEqual(edges, set(pairwise(path)))


if __name__ == "__main__":
    unittest.main(verbosity=2)
