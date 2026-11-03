import hashlib
import importlib.util
from pathlib import Path
import unittest

script = Path(__file__).resolve().parents[1] / 'scripts' / 'migrate_paths.py'
spec = importlib.util.spec_from_file_location('migration', script)
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


class MigrationTests(unittest.TestCase):
    def test_paths_and_old_button_id_are_preserved(self):
        old = r'C:\Users\Example\WIZArd'
        summary = old + r'\dados\resumos\sessao.md'
        record = {'summary': summary, 'summaryHash': 'abc', 'history': old + r'\dados\colecao.md', 'status': 'pending'}
        result = migration.migrate(record, old, '/opt/wizard')
        self.assertEqual(result['summary'], '/opt/wizard/dados/resumos/sessao.md')
        self.assertEqual(result['summaryHash'], 'abc')
        self.assertEqual(result['collectionId'], hashlib.sha256((summary + '.collection.json').encode()).hexdigest()[:32])
        self.assertEqual(migration.migrate(dict(result), old, '/opt/wizard'), result)

    def test_external_paths_and_campaign_text_unchanged(self):
        result = migration.migrate({'input': r'C:\Other\outside.txt', 'reason': r'C:\Users\Example\WIZArd\ficticio'}, r'C:\Users\Example\WIZArd', '/opt/wizard')
        self.assertEqual(result['input'], r'C:\Other\outside.txt')
        self.assertEqual(result['reason'], r'C:\Users\Example\WIZArd\ficticio')


if __name__ == '__main__':
    unittest.main()
