"""Transcrição local; nenhum serviço de API. Chamado pela fila do WIZArd.

Entrada (uma linha JSON no stdin):
- lista de caminhos: áudio misturado, sem nomes;
- {"tracks": [{"name", "path", "offset"}]}: uma faixa por pessoa; as falas saem
  intercaladas por horário e com o nome de quem falou.
"""
import argparse
import json
import os
from pathlib import Path
import uuid


def stamp(seconds):
    at = int(seconds)
    return f'[{at // 3600:02}:{at // 60 % 60:02}:{at % 60:02}]'


def line(seconds, text, name=None):
    return f'{stamp(seconds)} {name}: {text}' if name else f'{stamp(seconds)} {text}'


def interleave(entries):
    """entries: (início em segundos, nome, texto). Ordena por horário; empate mantém a ordem de chegada."""
    return [line(at, text, name) for at, name, text in sorted(entries, key=lambda e: e[0]) if text]


def vocabulary(path):
    """Palavras esperadas (nomes, jogos, termos), na ordem do arquivo. Linhas com # são ignoradas."""
    if not path or not Path(path).is_file():
        return []
    terms = []
    for raw in Path(path).read_text(encoding='utf-8').splitlines():
        term = raw.strip()
        if term and not term.startswith('#') and term not in terms:
            terms.append(term)
    return terms


# O Whisper aceita ~223 tokens de vocabulário e, se passar, descarta o COMEÇO.
# Aqui entra de cima para baixo até o limite: o topo do arquivo tem prioridade.
HOTWORD_TOKENS = 220


def fit(terms, count, limit=HOTWORD_TOKENS):
    chosen = []
    for term in terms:
        if count(' ' + ', '.join(chosen + [term])) > limit:
            break
        chosen.append(term)
    return chosen


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    parser.add_argument('--model', default='small')
    parser.add_argument('--language', default='pt')
    parser.add_argument('--threads', type=int, default=2)
    parser.add_argument('--vocab')
    args = parser.parse_args()
    data = json.loads(input())
    tracks = data.get('tracks') if isinstance(data, dict) else None
    paths = [t['path'] for t in tracks] if tracks else data
    if not paths or not all(Path(p).is_file() for p in paths):
        raise ValueError('audio indisponivel')
    from faster_whisper import WhisperModel
    import av
    model = WhisperModel(args.model, device='cpu', compute_type='int8', cpu_threads=args.threads, num_workers=1)
    terms = fit(vocabulary(args.vocab), lambda s: len(model.hf_tokenizer.encode(s).ids))
    options = dict(language=args.language, beam_size=5, vad_filter=True, hotwords=', '.join(terms) or None)
    output = Path(args.output)
    temp = output.with_name(output.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temp.open('x', encoding='utf-8') as text:
            if tracks:
                entries = []
                for track in tracks:
                    segments, _ = model.transcribe(track['path'], **options)
                    for segment in segments:
                        entries.append((float(track['offset']) + segment.start, track['name'], segment.text.strip()))
                for row in interleave(entries):
                    text.write(row + '\n')
            else:
                offset = 0
                for path in paths:
                    segments, _ = model.transcribe(path, **options)
                    for segment in segments:
                        if segment.text.strip():
                            text.write(line(offset + segment.start, segment.text.strip()) + '\n')
                    with av.open(path) as container:
                        if container.duration is None:
                            raise ValueError('duracao indisponivel')
                        offset += container.duration / av.time_base
            text.flush()
            os.fsync(text.fileno())
        if temp.stat().st_size == 0:
            raise ValueError('sem fala reconhecida')
        os.link(temp, output)  # Publicação exclusiva, sem sobrescrever o original.
    finally:
        temp.unlink(missing_ok=True)


if __name__ == '__main__':
    main()
