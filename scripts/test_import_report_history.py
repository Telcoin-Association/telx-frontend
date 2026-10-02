"""Tests for import-report-history.py on small synthetic sheets.

Run with: python -m unittest discover -s scripts -p "test_import_report_history.py"
"""

import importlib.util
import os
import unittest
from datetime import datetime, timezone

SPEC = importlib.util.spec_from_file_location("import_report_history", os.path.join(os.path.dirname(__file__), "import-report-history.py"))
converter = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(converter)


def day(y, m, d):
    return int(datetime(y, m, d, tzinfo=timezone.utc).timestamp())


POOL_ROWS = [
    # Date, Pool, Total Liquidity, Staked %, Staked Liquidity, Incentives APR, Volume, Fees, Fees APR, Total APR
    (datetime(2024, 5, 13), "TEL/WETH", 1165424.4, 0.99961, 1164994.2, 0.104912345, 36292.4, 72.584, 0.022712, 0.12761),
    (datetime(2024, 5, 14), "TEL/WETH", 1130426, "#DIV/0!", None, float("nan"), 72468, 144.94, "#N/A", 0.1519),
    # A repeated pool and day keeps the first row.
    (datetime(2024, 5, 14), "TEL/WETH", 1, 1, 1, 1, 1, 1, 1, 1),
    (datetime(2025, 8, 9), "TEL/WETH (BASE)", 378130.4665, 1, 378130.4665, 0.3, 12733.3, 44.56, 0.04, 0.34),
    # A pool the mapping doesn't know is skipped and reported.
    (datetime(2024, 5, 13), "TEL/XYZ", 10, 1, 10, 0.1, 1, 0.01, 0.1, 0.2),
    # A date the report hadn't reached yet: no figures at all.
    (datetime(2025, 10, 20), "TEL/WETH", None, None, None, None, None, None, None, None),
    # The totals row below the data has no date.
    (None, None, 972032.02, 0.98, 963904.8, 0.21, 319659222.3, 653897.19, 0.07, 0.28),
]

PROGRAM_ROWS = [
    # Date, Total Liquidity, Staked %, Staked Liquidity, Incentives APR, Volume, Fees, Fees APR, Total APR, TEL Price
    (datetime(2024, 5, 13), 6025990, 0.9874314, 5950252, 0.1551333, 203915, 418.08, 0.0241333, 0.17925, None),
    (datetime(2024, 7, 28), 6000000, 0.98, 5900000, 0.15, 200000, 400, 0.024, 0.174, 0.0031234567),
    # Future dates carry only a TEL price of 0.
    (datetime(2025, 12, 31), None, None, None, None, None, None, None, None, 0),
]


class ConverterTest(unittest.TestCase):
    def setUp(self):
        self.result, self.counts = converter.build(POOL_ROWS, PROGRAM_ROWS)
        self.pools = {pool["key"]: pool for pool in self.result["pools"]}

    def test_maps_pools_and_keeps_the_mapping_fields(self):
        weth = self.pools["balancer-tel-weth"]
        self.assertEqual(weth["chain"], "polygon")
        self.assertEqual(weth["protocol"], "balancer")
        self.assertEqual(weth["address"], "0xca6efa5704f1ae445e0ee24d9c3ddde34c5be1c2")
        base = self.pools["uniswap-v4-2025-base-tel-eth"]
        self.assertIsNone(base["address"])
        self.assertEqual(len(base["candidates"]), 2)

    def test_rounds_levels_to_dollars_fees_to_cents_and_fractions_to_five_places(self):
        first = self.pools["balancer-tel-weth"]["days"][0]
        self.assertEqual(first, [day(2024, 5, 13), 1165424, 0.99961, 1164994, 0.10491, 36292, 72.58, 0.02271, 0.12761])

    def test_errors_empty_and_non_finite_cells_become_null_and_are_counted(self):
        second = self.pools["balancer-tel-weth"]["days"][1]
        self.assertEqual(second, [day(2024, 5, 14), 1130426, None, None, None, 72468, 144.94, None, 0.1519])
        # 4 cells in that row, plus the missing TEL price on 2024-05-13.
        self.assertEqual(self.counts.dropped, 5)

    def test_keeps_the_first_row_for_a_repeated_pool_and_day(self):
        self.assertEqual(len(self.pools["balancer-tel-weth"]["days"]), 2)

    def test_skips_rows_without_figures_and_unmapped_pools(self):
        self.assertEqual(self.counts.empty_rows, 2)
        self.assertEqual(self.counts.unknown_pools, {"TEL/XYZ": 1})
        self.assertNotIn(day(2025, 10, 20), [row[0] for row in self.pools["balancer-tel-weth"]["days"]])

    def test_program_rows_carry_tel_price_with_zero_treated_as_missing(self):
        program = self.result["program"]
        self.assertEqual([row[0] for row in program], [day(2024, 5, 13), day(2024, 7, 28)])
        self.assertIsNone(program[0][-1])
        self.assertEqual(program[1][-1], 0.00312346)

    def test_span_covers_every_day_written(self):
        self.assertEqual(self.result["from"], day(2024, 5, 13))
        self.assertEqual(self.result["to"], day(2025, 8, 9))
        self.assertEqual(self.result["poolFields"][0], "day")
        self.assertEqual(self.result["programFields"][-1], "telUSD")


if __name__ == "__main__":
    unittest.main()
