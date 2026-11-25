"""Investigation copilot: explain why a Nexus job failed, citing lineage evidence only.

Gathers an evidence bundle from Marquez (run history, upstream jobs, input checks,
blast radius, owners, SLA freshness), numbers each fact E1..En, and asks an LLM (a free
OpenRouter model by default) for a root-cause note that cites those ids. Without
OPENROUTER_API_KEY (or with
--evidence-only) it prints the bundle and makes no model call.

    python3 alerts/investigate.py analytics review_scores
"""

import argparse
import json
import logging
import os
import sys
from collections import Counter
from datetime import UTC, datetime
from urllib.error import HTTPError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from notify import (
    FAILED,
    LINEAGE_DEPTH,
    blast_radius,
    failed_checks,
    get_json,
    last_success,
    node_label,
    owners_of,
    stale_alert,
)

LOG = logging.getLogger("nexus.copilot")
MODEL = "openrouter/free"  # routes to any free model; override with NEXUS_COPILOT_MODEL
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL_TIMEOUT = 120
RUN_HISTORY = 10
MAX_TOKENS = 6000  # free models often reason first; leave room for the answer
SYSTEM = """You are the Nexus incident copilot for a data platform.
You receive numbered evidence (E1, E2, ...) taken from OpenLineage/Marquez.
Write a short incident note with four parts: Root cause, Impact, Who to tell, Next steps.
Rules:
- Every factual sentence ends with the evidence ids it rests on, like [E2, E5].
- Use only the evidence. If it cannot settle the root cause, say so and name what to check.
- Do not invent error messages, people, or numbers. Keep it under 200 words."""

Evidence = list[tuple[str, str]]


def upstream_jobs(graph: list[dict], start: str) -> list[dict]:
    """Job nodes upstream of `start`, nearest first (reverse walk over outEdges)."""
    parents: dict[str, list[str]] = {}
    for node in graph:
        for edge in node.get("outEdges") or []:
            parents.setdefault(edge["destination"], []).append(edge["origin"])
    by_id = {node["id"]: node for node in graph}
    seen, order, frontier = {start}, [], [start]
    while frontier:
        frontier = [p for n in frontier for p in parents.get(n, []) if p not in seen]
        seen.update(frontier)
        order += [by_id[n] for n in frontier if n.startswith("job:") and n in by_id]
    return order


def run_fact(job_id: str, runs: list[dict]) -> str:
    states = Counter(r.get("state") for r in runs)
    latest = runs[0] if runs else {}
    ok = next((r for r in runs if r.get("state") == "COMPLETED"), None)
    history = ", ".join(f"{n} {s}" for s, n in states.most_common())
    last_ok = ok.get("endedAt") if ok else f"none in the last {len(runs)} runs"
    return (
        f"Job {node_label(job_id)} latest run {latest.get('state', 'unknown')} at "
        f"{latest.get('endedAt') or latest.get('updatedAt') or 'unknown time'}; "
        f"last {len(runs)} runs: {history or 'none'}; last success: {last_ok}."
    )


def build_evidence(
    job_id: str,
    graph: list[dict],
    runs: list[dict],
    datasets: dict[str, dict],
    owners: list[str],
    now: datetime,
) -> Evidence:
    """Number the facts. `datasets` maps node id -> full dataset (with facets, lastSuccess)."""
    facts = [run_fact(job_id, runs)]
    ups = upstream_jobs(graph, job_id)
    bad = [
        n
        for n in ups
        if ((n.get("data") or {}).get("latestRun") or {}).get("state") in FAILED
    ]
    facts += [f"Upstream job {node_label(n['id'])} latest run FAILED." for n in bad]
    facts.append(
        f"{len(ups) - len(bad)} of {len(ups)} upstream jobs last completed fine."
    )
    node = next((n for n in graph if n["id"] == job_id), {})
    inputs = [
        e["origin"]
        for n in graph
        for e in n.get("outEdges") or []
        if e["destination"] == job_id
    ]
    for ds_id in inputs:
        for check in failed_checks(datasets.get(ds_id, {})):
            name = check.get("assertion") or check.get("name") or "check"
            column = f" on column {check['column']}" if check.get("column") else ""
            facts.append(
                f"Input {node_label(ds_id)} failed data-quality check {name}{column}."
            )
    radius = blast_radius(graph, job_id)
    outputs = [node_label(o) for o in radius["outputs"]]
    facts.append(
        f"Downstream: {len(radius['jobs'])} jobs, {len(radius['datasets'])} datasets; "
        f"business outputs: {', '.join(outputs) or 'none'}."
    )
    for ds_id in radius["outputs"]:
        ds = datasets.get(ds_id)
        alert = stale_alert(ds, ds.get("lastSuccess"), now) if ds else None
        facts += (
            [f"Output is past its SLA: {alert['text'].lstrip('⏱ ')}."] if alert else []
        )
    facts.append(f"Owners of affected outputs: {', '.join(owners) or 'none recorded'}.")
    if not node:
        facts.append(
            "The job is not in the lineage graph; lineage evidence is missing."
        )
    return [(f"E{i}", fact) for i, fact in enumerate(facts, 1)]


def render(evidence: Evidence) -> str:
    return "\n".join(f"[{eid}] {fact}" for eid, fact in evidence)


def fetch_dataset(api: str, node_id: str) -> dict:
    namespace, name = node_id.removeprefix("dataset:").rsplit(":", 1)
    path = f"namespaces/{quote(namespace, safe='')}/datasets/{quote(name, safe='')}"
    dataset = get_json(api, path)
    if (dataset.get("facets") or {}).get("sla"):
        dataset = {**dataset, "lastSuccess": last_success(api, dataset)}
    return dataset


def gather(api: str, namespace: str, job: str) -> Evidence:
    job_id = f"job:{namespace}:{job}"
    query = urlencode({"nodeId": job_id, "depth": LINEAGE_DEPTH})
    graph = get_json(api, f"lineage?{query}")["graph"]
    runs_path = (
        f"namespaces/{quote(namespace, safe='')}/jobs/{quote(job, safe='')}/runs"
    )
    runs = get_json(api, f"{runs_path}?limit={RUN_HISTORY}")["runs"]
    radius = blast_radius(graph, job_id)
    inputs = {
        e["origin"]
        for n in graph
        for e in n.get("outEdges") or []
        if e["destination"] == job_id
    }
    datasets = {
        d: fetch_dataset(api, d) for d in sorted(inputs | set(radius["outputs"]))
    }
    owners = owners_of(api, radius["outputs"])
    return build_evidence(job_id, graph, runs, datasets, owners, datetime.now(UTC))


def ask_model(namespace: str, job: str, evidence: Evidence, key: str) -> str:
    """One chat-completions call to OpenRouter (OpenAI-compatible); stdlib only."""
    question = f"Why did job {namespace}/{job} fail, and what does it break?"
    body = {
        "model": os.environ.get("NEXUS_COPILOT_MODEL", MODEL),
        "max_tokens": MAX_TOKENS,
        "reasoning": {"effort": "low", "exclude": True},
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": f"{question}\n\nEvidence:\n{render(evidence)}"},
        ],
    }
    request = Request(
        OPENROUTER_URL,
        data=json.dumps(body).encode(),
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "User-Agent": "nexus-copilot",  # the CDN resets the default urllib agent
        },
    )
    try:
        with urlopen(request, timeout=MODEL_TIMEOUT) as response:
            reply = json.load(response)
    except HTTPError as error:
        detail = error.read().decode(errors="replace")[:300]
        raise RuntimeError(f"OpenRouter returned {error.code}: {detail}") from error
    choices = reply.get("choices") or []
    text = (choices[0].get("message") or {}).get("content") if choices else None
    if not text:
        raise RuntimeError(f"Model returned no text: {str(reply)[:300]}")
    return f"({reply.get('model', body['model'])})\n{text.strip()}"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Explain a failed Nexus job from lineage evidence."
    )
    parser.add_argument("namespace")
    parser.add_argument("job")
    api = os.environ.get("NEXUS_API", "http://127.0.0.1:15000/api/v1")
    parser.add_argument("--api", default=api, help="Marquez API base URL")
    parser.add_argument(
        "--evidence-only",
        action="store_true",
        help="print evidence, skip the model call",
    )
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    try:
        evidence = gather(args.api.rstrip("/"), args.namespace, args.job)
    except (OSError, ValueError, KeyError) as error:
        LOG.error(
            "Could not read %s/%s from Marquez: %s", args.namespace, args.job, error
        )
        return 2
    sys.stdout.write(f"Evidence\n{render(evidence)}\n")
    key = os.environ.get("OPENROUTER_API_KEY")
    if args.evidence_only or not key:
        LOG.info("No model call (set OPENROUTER_API_KEY to get a root-cause note).")
        return 0
    try:
        note = ask_model(args.namespace, args.job, evidence, key)
    except (OSError, RuntimeError, ValueError) as error:
        LOG.error("%s", error)
        return 1
    sys.stdout.write(f"\nCopilot note {note}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
