import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('capture', Path(__file__).resolve().parents[3] / 'scripts/capture-nfl-starts.py')
capture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture)


def table(heading, rows, columns=('WK', 'Game Date', 'G', 'GS')):
    return f'<h3>{heading}</h3><table><thead><tr>' + ''.join(f'<th>{column}</th>' for column in columns) + '</tr></thead><tbody>' + ''.join('<tr>' + ''.join(f'<td>{cell}</td>' for cell in row) + '</tr>' for row in rows) + '</tbody></table>'


class StartsCaptureTest(unittest.TestCase):
    def test_excludes_preseason_and_postseason_and_ignores_profile_heading(self):
        page = '<title>Example Player 2025 Logs Stats | NFL.com</title><h3>active</h3>'
        page += table('Preseason', [(1, '08/09/2025', 1, 1)])
        page += table('Regular Season', [(1, '09/07/2025', 1, 1), (2, '09/14/2025', 1, 0)])
        page += table('Post Season', [(1, '01/10/2026', 1, 1)])
        rows = capture.parse_game_log(page, 'Example Player')
        self.assertEqual(sum(row['starts'] for row in rows), 1)
        self.assertEqual(sum(row['games'] for row in rows), 2)

    def test_single_regular_table_after_profile_heading(self):
        page = '<title>Example Player 2025 Logs Stats</title><h3>active</h3>' + table('Regular Season', [(1, '09/07/2025', 1, 0)])
        self.assertEqual(capture.parse_game_log(page, 'Example Player')[0]['starts'], 0)

    def test_absent_starts_duplicates_and_wrong_identity_are_rejected(self):
        title = '<title>Example Player 2025 Logs Stats</title>'
        for page in [title + table('Preseason', [(1, '08/09/2025', 1, 1)]),
                     title + table('Regular Season', [(1, '09/07/2025', 1)], ('WK', 'Game Date', 'G')),
                     title + table('Regular Season', [(1, '09/07/2025', 1, 1)] * 2),
                     title + table('Regular Season', [(1, '09/07/2025', 0, 1)])]:
            with self.assertRaises(ValueError):
                capture.parse_game_log(page, 'Example Player')
        with self.assertRaises(ValueError):
            capture.parse_game_log(title + table('Regular Season', [(1, '09/07/2025', 1, 1)]), 'Different Player')


if __name__ == '__main__':
    unittest.main()
