"""Migra apenas caminhos de JSON, com backup. Não altera texto/hashes da campanha."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import uuid

PATH_KEYS = {'input', 'output', 'summary', 'history', 'historyBackup', 'transcript'}


def convert(value, old, new):
    normalized = value.replace('\\', '/')
    base = old.replace('\\', '/').rstrip('/')
    if normalized.lower().startswith(base.lower() + '/'):
        return new.rstrip('/') + normalized[len(base):]
    return value


def migrate(record, old, new):
    if not isinstance(record, dict):
        return record
    # Os botões já enviados ao Discord precisam conservar seu ID após a migração.
    if isinstance(record.get('summary'), str) and 'summaryHash' in record:
        record.setdefault('collectionId', hashlib.sha256((record['summary'] + '.collection.json').encode()).hexdigest()[:32])
    for key, value in list(record.items()):
        if key in PATH_KEYS and isinstance(value, str):
            record[key] = convert(value, old, new)
        elif key == 'audio' and isinstance(value, list):
            record[key] = [convert(p, old, new) for p in value]
        elif key == 'audioHashes' and isinstance(value, dict):
            record[key] = {convert(p, old, new): h for p, h in value.items()}
        elif isinstance(value, dict):
            record[key] = migrate(value, old, new)
    return record


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', required=True)
    parser.add_argument('--from-root', required=True)
    parser.add_argument('--to-root', required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    root = Path(args.data).resolve()
    changed = 0
    for path in root.rglob('*.json'):
        if path.is_symlink() or not path.is_file() or root not in path.resolve().parents:
            continue
        original = path.read_text(encoding='utf-8')
        data = json.loads(original)
        updated = migrate(json.loads(original), args.from_root, args.to_root)
        if updated == data:
            continue
        changed += 1
        if args.apply:
            backup = path.with_name(path.name + '.antes-migracao')
            if backup.exists():
                raise ValueError('backup de migracao ja existe; revisar manualmente')
            shutil.copy2(path, backup)
            temp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
            try:
                temp.write_text(json.dumps(updated, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
                temp.replace(path)
            finally:
                temp.unlink(missing_ok=True)
    print(f'{changed} arquivo(s) ' + ('migrado(s).' if args.apply else 'precisam de migracao; execute --apply apos revisar os argumentos.'))


if __name__ == '__main__':
    main()
