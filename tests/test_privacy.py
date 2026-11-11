"""N1.8 (audit N5, N7): the privacy policy and truthful texts.

- PRIVACY.md / PRIVACY.cs.md exist, are linked from the READMEs and About,
  and say what is and is not encrypted (images are not), the contact, the
  log and the network facts.
- The main sentence (README, README.cs, social preview) promises no
  encryption: locking with a password is what users do.
- The name of the window component (WebView2) is allowed only where users
  need it: the privacy policy, the README install section, the installer and
  the message about the missing component. Not in the UI, the main sentence
  or the feature list.
"""

import json
import re

import pytest

from conftest import ROOT

MAIN = {
    "README.md": "**Markdown notes you can lock with a password – for Windows.**",
    "README.cs.md": "**Markdown poznámky, které můžete zamknout heslem – pro Windows.**",
}
NO_ENCRYPTION = re.compile(r"encrypt|šifr", re.I)
COMPONENT = re.compile(r"webview\s*2", re.I)


def _read(name):
    return (ROOT / name).read_text(encoding="utf-8")


# ---- the policy ---------------------------------------------------------------

POLICY = {
    "PRIVACY.md": [
        "NoirPad itself sends no data anywhere. It has no\naccount and no telemetry.",
        "Only the text and formatting (including links) of locked notes are encrypted",
        "If you forget the password, the text\ncannot be recovered – not even by us.",
        "**images (also in locked notes)**",
        "Locked notes created before 1.1.0 keep their formatting and links readable until you unlock them\nonce with the password.",
        "NoirPad also removes readable text from its automatic copies, but Windows or the disk may keep an\nolder version of a file for a while.",
        "It never contains the content of\nyour notes",
        "Microsoft WebView2",
        "https://privacy.microsoft.com/privacystatement",
        "provided by the Microsoft Store",
        "with us in Partner Center. NoirPad itself sends nothing.",
        "It is a copy: the GitHub\nedition's folder stays as it is.",
        "Automatic copies (backups) are not copied.",
        "(N1.11)",
        "mailto:arclystudio.dev@gmail.com",
        "[Čeština](PRIVACY.cs.md)",
    ],
    "PRIVACY.cs.md": [
        "Sám nikam neposílá žádná data. Nemá účet ani\ntelemetrii.",
        "Šifruje se jen text a formátování (včetně odkazů) zamčených poznámek",
        "Když heslo zapomenete, text nejde obnovit – ani námi.",
        "**obrázky (i v zamčených poznámkách)**",
        "U zamčených poznámek z verzí před 1.1.0 zůstává formátování a odkazy čitelné, dokud je jednou\nneodemknete heslem.",
        "NoirPad smaže čitelný text i ze svých automatických kopií, ale Windows nebo disk si můžou starší\nverzi souboru ještě nějakou dobu držet.",
        "Nikdy v něm není obsah poznámek",
        "Microsoft WebView2",
        "https://privacy.microsoft.com/cs-cz/privacystatement",
        "zajišťuje Microsoft Store",
        "Reporting). NoirPad sám nic neposílá.",
        "Je to kopie: složka GitHub edice\nzůstane, jak je.",
        "Automatické kopie (zálohy) se nekopírují.",
        "(N1.11)",
        "mailto:arclystudio.dev@gmail.com",
        "[English](PRIVACY.md)",
    ],
}


@pytest.mark.parametrize("name", sorted(POLICY))
def test_policy_says_what_was_approved(name):
    text = _read(name).replace("\r\n", "\n")
    missing = [s for s in POLICY[name] if s not in text]
    assert missing == []


@pytest.mark.parametrize("name", sorted(POLICY))
def test_policy_does_not_say_locked_notes_are_encrypted(name):
    """Only their text and formatting are: no blanket claim (approved wording a)."""
    text = _read(name).replace("\n", " ")
    assert not re.search(r"(?<!of )\blocked notes are encrypted|šifrované jsou (jen |pouze )?zamčené poznámky",
                         text, re.I)


@pytest.mark.parametrize("readme, policy", [("README.md", "PRIVACY.md"), ("README.cs.md", "PRIVACY.cs.md")])
def test_readme_links_the_policy(readme, policy):
    assert f"]({policy})" in _read(readme)


def test_about_links_the_policy():
    html = _read("static/index.html")
    assert 'id="about-privacy"' in html and 'data-i18n="ui.settings.privacyLink"' in html
    js = _read("static/js/settings.js")
    assert '"/blob/main/"' in js and '"PRIVACY.cs.md" : "PRIVACY.md"' in js


# ---- the main sentence --------------------------------------------------------

@pytest.mark.parametrize("name", sorted(MAIN))
def test_main_sentence(name):
    lines = _read(name).splitlines()
    sentence = next(ln for ln in lines if ln.startswith("**"))      # first bold line under the title
    assert sentence == MAIN[name]
    assert not NO_ENCRYPTION.search(sentence)


def test_social_preview_main_sentence():
    html = _read("docs/brand/social-preview.html")
    claim = re.search(r'<div class="t">.*?</p>', html, re.S).group(0)
    assert "<b>Markdown notes you can lock with a password</b> – for Windows." in claim
    assert not NO_ENCRYPTION.search(claim)


# ---- where the component's name may appear ------------------------------------

def _strings(node):
    if isinstance(node, dict):
        for v in node.values():
            yield from _strings(v)
    elif isinstance(node, list):
        for v in node:
            yield from _strings(v)
    elif isinstance(node, str):
        yield node


@pytest.mark.parametrize("lang", ["en", "cs"])
def test_component_name_not_in_the_ui(lang):
    data = json.loads(_read(f"static/locales/{lang}.json"))
    assert [s for s in _strings(data) if COMPONENT.search(s)] == []


def test_component_name_not_in_index_or_help():
    html = re.sub(r"<!--.*?-->|<script.*?</script>", "", _read("static/index.html"), flags=re.S)
    assert not COMPONENT.search(html)
    help_js = re.sub(r"/\*.*?\*/|//[^\n]*", "", _read("static/js/help.js"), flags=re.S)
    assert not COMPONENT.search(help_js)


@pytest.mark.parametrize("name, install", [("README.md", "Install"), ("README.cs.md", "Instalace")])
def test_component_name_in_readme_only_in_install(name, install):
    """Main sentence, feature list and everything else: no; the install section: yes."""
    text = _read(name)
    section = re.search(rf"(?ms)^## {install}\n.*?(?=^## )", text).group(0)
    assert COMPONENT.search(section)
    assert not COMPONENT.search(text.replace(section, ""))


def test_social_preview_title_and_second_line():
    """Green title (logo accent), second line without a second "Windows"."""
    html = _read("docs/brand/social-preview.html")
    assert re.search(r"h1\{[^}]*color:#00ff41", html)
    assert "<br>No account, no cloud.</p>" in html
    assert "7ab6ff" not in html.lower()
