"""Nexus alerts: failing jobs with their blast radius and failed data-quality checks,
sent through Apprise to Slack, Telegram, Teams, email and 100+ other services.

Reads the Marquez API, the same data the Nexus UI shows. Destinations are Apprise URLs in
NEXUS_ALERT_URLS (space or comma separated), e.g. "tgram://bot-token/chat-id slack://T/B/C".
Long messages: add Apprise's "?overflow=split" to a URL to split instead of truncate.

Usage:
    python alerts/notify.py --dry-run                   # print the alert, send nothing
    python alerts/notify.py --state .nexus-alerts.json  # send only what is new since last run

Exit codes: 0 ok, 1 delivery failed, 2 Marquez unreachable or returned bad data.
"""

import argparse
import json
import logging
import os
import sys
from collections import deque
from pathlib import Path
from urllib.parse import quote, urlencode, urlparse
from urllib.request import urlopen

LOG = logging.getLogger("nexus.alerts")
FAILED = {"FAILED", "ABORTED"}
LINEAGE_DEPTH = 20
MAX_NAMESPACES = 100
MAX_JOBS = 500
# Marquez attaches facets to the first 10 datasets of each page only, so page by 10.
DATASET_PAGE = 10
MAX_LISTED_OUTPUTS = 5

Alert = dict[str, str]


def get_json(api: str, path: str) -> dict:
    with urlopen(f"{api}/{path}", timeout=15) as response:
        return json.loads(response.read())


def blast_radius(graph: list[dict], start: str) -> dict[str, list[str]]:
    """Downstream jobs, datasets and terminal outputs of `start` (same rules as the UI)."""
    edges = [e for node in graph for e in node.get("outEdges") or []]
    nxt: dict[str, list[str]] = {}
    for edge in edges:
        nxt.setdefault(edge["origin"], []).append(edge["destination"])
    seen, queue = {start}, deque([start])
    while queue:
        for node_id in nxt.get(queue.popleft(), []):
            if node_id not in seen:
                seen.add(node_id)
                queue.append(node_id)
    down = sorted(seen - {start})
    consumed = {edge["origin"] for edge in edges}
    datasets = [n for n in down if n.startswith("dataset:")]
    return {
        "jobs": [n for n in down if n.startswith("job:")],
        "datasets": datasets,
        "outputs": [n for n in datasets if n not in consumed],
    }


def failed_checks(dataset: dict) -> list[dict]:
    facet = (dataset.get("facets") or {}).get("dataQualityAssertions") or {}
    assertions = facet.get("assertions") or []
    return [a for a in assertions if isinstance(a, dict) and a.get("success") is False]


def node_label(node_id: str) -> str:
    # node ids are kind:namespace:name; namespaces may contain colons (URIs), names do not.
    return node_id.rsplit(":", 1)[-1]


def owners_of(api: str, dataset_ids: list[str]) -> list[str]:
    """Owner names from the ownership facet of each dataset; a failed lookup is skipped."""
    names: set[str] = set()
    for node_id in dataset_ids:
        namespace, name = node_id.removeprefix("dataset:").rsplit(":", 1)
        path = f"namespaces/{quote(namespace, safe='')}/datasets/{quote(name, safe='')}"
        try:
            facets = get_json(api, path).get("facets") or {}
        except (OSError, ValueError) as error:
            LOG.warning("No owners for %s: %s", node_id, error)
            continue
        owners = (facets.get("ownership") or {}).get("owners") or []
        names.update(
            o["name"]
            for o in owners
            if isinstance(o, dict) and isinstance(o.get("name"), str)
        )
    return sorted(names)


def job_alert(
    job: dict, radius: dict[str, list[str]], ui: str, owners: tuple[str, ...] = ()
) -> Alert:
    run = job["latestRun"]
    when = run.get("endedAt") or run.get("updatedAt") or "unknown time"
    outputs = [node_label(o) for o in radius["outputs"]]
    more = " …" if len(outputs) > MAX_LISTED_OUTPUTS else ""
    shown = ", ".join(outputs[:MAX_LISTED_OUTPUTS]) + more
    risk = f" Outputs at risk: {shown}" if outputs else " No business outputs at risk."
    query = urlencode(
        {"kind": "job", "namespace": job["namespace"], "name": job["name"]}
    )
    lines = [
        f"✖ {job['namespace']} / {job['name']}: {run['state']} at {when}",
        f"  Downstream: {len(radius['jobs'])} jobs, {len(radius['datasets'])} datasets.{risk}",
        *([f"  Owners: {', '.join(owners)}"] if owners else []),
        f"  {ui}/#lineage?{query}",
    ]
    return {"key": f"run:{run['id']}", "kind": "job", "text": "\n".join(lines)}


def check_alert(dataset: dict, check: dict) -> Alert:
    level = "warn" if check.get("severity") == "warn" else "error"
    name = check.get("name") or check.get("assertion") or "unnamed check"
    column = f" ({check['column']})" if check.get("column") else ""
    actual = check.get("actual")
    rows = f" on {actual} rows" if actual not in (None, "") else ""
    # The failing row count is part of the key, so a check that gets worse alerts again.
    key = f"check:{dataset['namespace']}/{dataset['name']}/{name}/{check.get('column')}/{actual}"
    icon = "⚠" if level == "warn" else "✖"
    text = f"{icon} {dataset['name']}: {name}{column} failed{rows} [{level}]"
    return {"key": key, "kind": "check", "text": text}


def capped(items: list[dict], limit: int, what: str) -> list[dict]:
    if len(items) >= limit:
        LOG.warning(
            "Read the first %d %s only; later ones are not checked.", limit, what
        )
    return items


def list_datasets(api: str, namespace: str) -> list[dict]:
    datasets, offset = [], 0
    while True:
        query = f"limit={DATASET_PAGE}&offset={offset}"
        page = get_json(api, f"namespaces/{quote(namespace, safe='')}/datasets?{query}")
        datasets += page["datasets"]
        offset += DATASET_PAGE
        if len(page["datasets"]) < DATASET_PAGE:
            return datasets


def job_alerts(api: str, ui: str, namespaces: set[str]) -> list[Alert]:
    jobs = capped(get_json(api, f"jobs?limit={MAX_JOBS}")["jobs"], MAX_JOBS, "jobs")
    alerts = []
    for job in jobs:
        state = (job.get("latestRun") or {}).get("state")
        if job["namespace"] not in namespaces or state not in FAILED:
            continue
        node_id = f"job:{job['namespace']}:{job['name']}"
        query = urlencode({"nodeId": node_id, "depth": LINEAGE_DEPTH})
        graph = get_json(api, f"lineage?{query}")["graph"]
        radius = blast_radius(graph, node_id)
        owners = tuple(owners_of(api, radius["outputs"]))
        alerts.append(job_alert(job, radius, ui, owners))
    return alerts


def collect(api: str, ui: str) -> list[Alert]:
    listed = get_json(api, f"namespaces?limit={MAX_NAMESPACES}")["namespaces"]
    visible = capped(listed, MAX_NAMESPACES, "namespaces")
    namespaces = {n["name"] for n in visible if not n.get("isHidden")}
    alerts = job_alerts(api, ui, namespaces)
    for namespace in sorted(namespaces):
        datasets = list_datasets(api, namespace)
        alerts += [check_alert(d, c) for d in datasets for c in failed_checks(d)]
    return alerts


def compose(alerts: list[Alert]) -> tuple[str, str]:
    jobs = sum(a["kind"] == "job" for a in alerts)
    checks = len(alerts) - jobs
    title = (
        f"Nexus: {jobs} failing job{'s' * (jobs != 1)}, "
        f"{checks} failed check{'s' * (checks != 1)}"
    )
    return title, "\n\n".join(a["text"] for a in alerts)


def load_state(path: Path | None) -> set[str]:
    if path is None or not path.exists():
        return set()
    try:
        keys = json.loads(path.read_text())
    except ValueError as error:
        LOG.warning("Ignoring unreadable state file %s: %s", path, error)
        return set()
    return {k for k in keys if isinstance(k, str)} if isinstance(keys, list) else set()


def save_state(path: Path, alerts: list[Alert]) -> None:
    # Keep only keys still failing, so something that recovers and fails again alerts again.
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(sorted(a["key"] for a in alerts)))
    os.replace(tmp, path)


def send(urls: list[str], title: str, body: str) -> bool:
    import apprise  # only needed when actually sending

    notifier = apprise.Apprise()
    for url in urls:
        if not notifier.add(url):
            raise ValueError("Apprise rejected one of the NEXUS_ALERT_URLS entries")
    return notifier.notify(title=title, body=body)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Send Nexus failure alerts through Apprise."
    )
    api = os.environ.get("NEXUS_API", "http://127.0.0.1:15000/api/v1")
    parser.add_argument("--api", default=api, help="Marquez API base URL")
    ui = os.environ.get("NEXUS_UI", "http://127.0.0.1:13000")
    parser.add_argument("--ui", default=ui, help="Nexus UI base URL for links")
    parser.add_argument("--state", type=Path, help="JSON file of alerts already sent")
    parser.add_argument("--dry-run", action="store_true", help="print, do not send")
    args = parser.parse_args()
    for url in (args.api, args.ui):
        if urlparse(url).scheme not in ("http", "https"):
            parser.error(f"not an http(s) URL: {url}")
    args.urls = os.environ.get("NEXUS_ALERT_URLS", "").replace(",", " ").split()
    if not args.dry_run and not args.urls:
        parser.error(
            "set NEXUS_ALERT_URLS to one or more Apprise URLs, or use --dry-run"
        )
    return args


def main() -> int:
    args = parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    try:
        current = collect(args.api.rstrip("/"), args.ui.rstrip("/"))
    except (OSError, ValueError, KeyError) as error:  # URLError/timeouts are OSError
        LOG.error("Could not read Marquez at %s: %s", args.api, error)
        return 2
    sent = load_state(args.state)
    fresh = [a for a in current if a["key"] not in sent]
    if args.dry_run:
        title, body = compose(fresh) if fresh else ("No new failures.", "")
        sys.stdout.write(f"{title}\n\n{body}\n")
        return 0
    if fresh:
        title, body = compose(fresh)
        if not send(args.urls, title, body):
            LOG.error(
                "Apprise could not deliver to every destination; will retry next run."
            )
            return 1
        LOG.info("Sent: %s", title)
    else:
        LOG.info("No new failures (%d already alerted).", len(current))
    if args.state:
        save_state(args.state, current)
    return 0


if __name__ == "__main__":
    sys.exit(main())
