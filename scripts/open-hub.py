"""Open the consolidated local app; viewing never schedules charging."""
import json
import os
import subprocess
import time
import webbrowser
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent.parent
LEGACY = ROOT.parent / 'neptune-charge-scheduler'
if not (LEGACY / 'ui_server.py').is_file():
    LEGACY = ROOT / 'native/windows'
RUNTIME = Path.home() / '.cache/codex-runtimes/codex-primary-runtime/dependencies'
FLAGS = getattr(subprocess, 'CREATE_NO_WINDOW', 0)

def health(url, expected):
    try:
        with urlopen(url + '/health', timeout=2) as response:
            return json.load(response).get('app') == expected
    except (OSError, ValueError):
        return False

def main():
    # Reuse the existing Windows worker and its original account/task paths.
    connection = LEGACY / '.local/ui-connection.json'
    try:
        windows_url = json.loads(connection.read_text(encoding='utf-8'))['url']
    except (OSError, ValueError, KeyError):
        windows_url = ''
    if (LEGACY / 'ui_server.py').is_file() and not health(windows_url, 'neptune-charge-ui'):
        subprocess.Popen([str(RUNTIME / 'python/pythonw.exe'), str(LEGACY / 'ui_server.py')], cwd=LEGACY, creationflags=FLAGS)
    url = 'http://127.0.0.1:3086'
    if not health(url, 'neptune-charge-hub'):
        if not (ROOT / 'out/index.html').is_file():
            raise RuntimeError('Build the unified web app first.')
        subprocess.Popen([str(RUNTIME / 'node/bin/node.exe'), str(ROOT / 'scripts/serve-static.mjs')], cwd=ROOT, creationflags=FLAGS)
        for _ in range(40):
            if health(url, 'neptune-charge-hub'):
                break
            time.sleep(.25)
        else:
            raise RuntimeError('Local app did not become ready.')
    webbrowser.open(url)

if __name__ == '__main__':
    main()
