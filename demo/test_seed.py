"""Consistency checks for the demo seed: python -m unittest discover demo"""

import unittest

from seed import (
    COLUMN_LINEAGE,
    JOBS,
    MODELS,
    SOURCES,
    SLA_HOURS,
    TEAMS,
    blocked_today,
    dataset_ref,
)


def columns(dataset: str) -> list[str]:
    return SOURCES[dataset][2] if dataset in SOURCES else MODELS[dataset]


class SeedTest(unittest.TestCase):
    def test_column_lineage_points_at_real_columns_of_job_inputs(self):
        inputs = {out: set(ins) for _, _, _, ins, outs, _, _ in JOBS for out in outs}
        for dataset, mapping in COLUMN_LINEAGE.items():
            for column, (sources, _) in mapping.items():
                self.assertIn(column, columns(dataset), f"{dataset}.{column}")
                for source, field in sources:
                    self.assertIn(source, inputs[dataset], f"{dataset} <- {source}")
                    self.assertIn(field, columns(source), f"{source}.{field}")

    def test_every_business_output_has_an_owner(self):
        reports = {
            n
            for _, _, _, _, outs, _, _ in JOBS
            for n in outs
            if n.startswith("report.")
        }
        self.assertEqual(reports, set(TEAMS))
        namespaces = {out: ns for ns, _, _, _, outs, _, _ in JOBS for out in outs}
        facets = dataset_ref("report.monthly_revenue", namespaces, True)["facets"]
        self.assertEqual(facets["sla"]["maxAgeHours"], SLA_HOURS)

    def test_jobs_are_in_pipeline_order(self):
        produced = set(SOURCES)
        for _, job, _, inputs, outputs, _, _ in JOBS:
            self.assertLessEqual(set(inputs), produced | set(outputs), job)
            produced |= set(outputs)

    def test_reports_behind_todays_failures_are_blocked(self):
        blocked = blocked_today()
        self.assertIn("publish_monthly_revenue", blocked)
        self.assertIn("publish_seller_scorecard", blocked)
        self.assertNotIn("publish_logistics_dashboard", blocked)


if __name__ == "__main__":
    unittest.main()
