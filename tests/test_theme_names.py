"""N1.6: no other products' names in what users read.

Themes have descriptive names (locale keys themes.<id>); the internal ids
and the saved values stay. The old names may appear only in the
third-party licence notices (N1.7). This guards future texts too: every
locale string, the visible text of index.html, the help, the command
suggestions and the READMEs outside their licence section.
"""

import json
import re
from html.parser import HTMLParser

import pytest

from conftest import ROOT

STATIC = ROOT / "static"
FORBIDDEN = re.compile(r"matrix|dracula|synthwave|\bnord\b|gruvbox|tokyo", re.I)
IDS = ["matrix", "amber", "cyan", "red", "purple", "blue", "pink", "white", "gold", "lime",
       "orange", "ice", "dracula", "synthwave", "nord", "gruvbox", "tokyo-night"]
SLUGS = {"matrix": "phosphor", "dracula": "lavender", "synthwave": "neon", "nord": "slate",
         "gruvbox": "retro", "tokyo-night": "midnight"}


def _strings(node, path=""):
    if isinstance(node, dict):
        for k, v in node.items():
            yield from _strings(v, f"{path}.{k}" if path else k)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from _strings(v, f"{path}[{i}]")
    elif isinstance(node, str):
        yield path, node


def _locale(lang):
    return json.loads((STATIC / "locales" / f"{lang}.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("lang", ["en", "cs"])
def test_locale_texts_have_no_foreign_names(lang):
    hits = [(k, v) for k, v in _strings(_locale(lang)) if FORBIDDEN.search(v)]
    assert not hits


class _Visible(HTMLParser):
    """Text nodes and the attributes people read or hear."""
    ATTRS = {"title", "alt", "placeholder", "aria-label", "aria-description", "value", "content"}

    def __init__(self):
        super().__init__()
        self.out, self._skip = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self._skip += 1
        for name, value in attrs:
            if name in self.ATTRS and value and not (tag == "div" and name == "value"):
                self.out.append(f"<{tag} {name}> {value}")

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self._skip -= 1

    def handle_data(self, data):
        if not self._skip and data.strip():
            self.out.append(data.strip())


def test_index_html_visible_text_has_no_foreign_names():
    parser = _Visible()
    parser.feed((STATIC / "index.html").read_text(encoding="utf-8"))
    assert parser.out, "parser found no text"
    assert [t for t in parser.out if FORBIDDEN.search(t)] == []


def _code(path):
    """JS without comments: the string literals that are not locale keys."""
    js = (STATIC / "js" / path).read_text(encoding="utf-8")
    js = re.sub(r"/\*.*?\*/", "", js, flags=re.S)
    js = re.sub(r"(?m)(^|[^:\"'])//.*$", r"\1", js)
    lits = re.findall(r'"((?:[^"\\\n]|\\.)*)"', js)
    return [s for s in lits if not re.fullmatch(r"[\w-]+(\.[\w-]+)+", s)]


def test_help_has_no_foreign_names():
    assert [s for s in _code("help.js") if FORBIDDEN.search(s)] == []


def test_command_suggestions_have_no_foreign_names():
    """What the command bar offers: its command table and the :theme names."""
    js = (STATIC / "js" / "command-bar.js").read_text(encoding="utf-8")
    table = re.search(r"var COMMANDS = \[(.*?)\];", js, re.S).group(1)
    cmds = re.findall(r'cmd:\s*"([^"]+)"', table)
    assert ":rain" in cmds and ":theme" in cmds
    assert [c for c in cmds if FORBIDDEN.search(c)] == []
    utils = (STATIC / "js" / "utils.js").read_text(encoding="utf-8")
    slugs = re.search(r"NP\.THEME_SLUGS = \{(.*?)\};", utils, re.S).group(1)
    shown = re.findall(r':\s*"([\w-]+)"', slugs)
    assert len(shown) == 17
    assert [s for s in shown if FORBIDDEN.search(s)] == []
    # Suggestions are built from the slugs, not from the ids (NP.THEMES).
    assert "NP.THEME_SLUGS" in js and "Object.keys(NP.THEMES)" not in js


def _without_licence(text):
    """The README minus its licence section (where the notices may name them)."""
    return re.sub(r"(?ims)^##\s*licen[cs]e.*?(?=^##\s|\Z)", "", text)


@pytest.mark.parametrize("name", ["README.md", "README.cs.md"])
def test_readme_outside_licences_has_no_foreign_names(name):
    text = _without_licence((ROOT / name).read_text(encoding="utf-8"))
    assert [ln for ln in text.splitlines() if FORBIDDEN.search(ln)] == []


def test_guard_catches_a_new_text():
    """The scan itself works: a fresh string with an old name is caught."""
    assert FORBIDDEN.search("Tokyo Night theme") and FORBIDDEN.search("Matrix déšť")
    assert FORBIDDEN.search("the Nord palette") and not FORBIDDEN.search("Nordic")
    assert _without_licence("# A\n## License\nDracula MIT\n## Next\nok\n") == "# A\n## Next\nok\n"
    parser = _Visible()
    parser.feed('<div data-value="dracula" id="matrix-canvas"><span title="Gruvbox">x</span></div>')
    assert [t for t in parser.out if FORBIDDEN.search(t)] == ["<span title> Gruvbox"]


@pytest.mark.parametrize("lang", ["en", "cs"])
def test_every_theme_has_a_shown_name(lang):
    names = _locale(lang)["themes"]
    assert sorted(names) == sorted(IDS)
    assert len(set(names.values())) == 17


def test_settings_lists_the_shown_names():
    html = (STATIC / "index.html").read_text(encoding="utf-8")
    dd = re.search(r'<div class="np-dropdown"[^>]*id="setting-theme".*?</div>\s*</div>\s*</div>', html, re.S).group(0)
    assert 'translate="no"' not in dd
    opts = re.findall(r'data-value="([\w-]+)"><span class="np-dropdown-marker">&rsaquo;</span>'
                      r'<span class="np-dropdown-option-label" data-i18n="themes\.([\w-]+)">', dd)
    assert [a for a, b in opts] == IDS and all(a == b for a, b in opts)


def test_slugs_in_the_help_match_utils():
    js = (STATIC / "js" / "help.js").read_text(encoding="utf-8")
    listed = re.findall(r"[\w-]+", " ".join(re.findall(r'"([a-z-]+(?:, [a-z-]+)+)"', re.search(
        r'title: "help\.themes\.title".*?\]\}', js, re.S).group(0))))
    assert sorted(listed) == sorted(SLUGS.get(i, i) for i in IDS)
