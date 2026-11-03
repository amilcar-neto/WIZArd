import importlib.util
from pathlib import Path
import tempfile
import unittest

script = Path(__file__).resolve().parents[1] / 'scripts' / 'transcribe.py'
spec = importlib.util.spec_from_file_location('transcribe', script)
transcribe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transcribe)


class TranscribeTests(unittest.TestCase):
    def test_falas_intercaladas_por_horario_com_nome(self):
        rows = transcribe.interleave([(12.4, 'Bruno', 'Seco?'), (7.9, 'Ana', 'Alô!'), (3700, 'Ana', 'fim'), (8, 'Bruno', '')])
        self.assertEqual(rows, ['[00:00:07] Ana: Alô!', '[00:00:12] Bruno: Seco?', '[01:01:40] Ana: fim'])

    def test_sem_nome_mantem_formato_antigo(self):
        self.assertEqual(transcribe.line(4, 'oi'), '[00:00:04] oi')

    def test_vocabulario_ignora_comentarios_e_repeticoes(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'v.txt'
            p.write_text('# comentário\nSekiro\n\nCaduceus\nSekiro\n', encoding='utf-8')
            self.assertEqual(transcribe.vocabulary(str(p)), ['Sekiro', 'Caduceus'])
        self.assertEqual(transcribe.vocabulary(None), [])

    def test_vocabulario_grande_mantem_o_topo_do_arquivo(self):
        words = lambda s: len(s.split())
        self.assertEqual(transcribe.fit(['Wolfgang', 'Cecília', 'Erich', 'Sekiro'], words, limit=3), ['Wolfgang', 'Cecília', 'Erich'])
        self.assertEqual(transcribe.fit([], words), [])


if __name__ == '__main__':
    unittest.main()
