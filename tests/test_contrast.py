"""D12: secondary text (--fg-dim) on bars and buttons (--bg-light) reaches
WCAG AA 4.5:1 in every theme. Computed from static/css/themes.css."""

import re

import pytest

from conftest import ROOT

CSS = re.sub(r"/\*.*?\*/", "", (ROOT / "static" / "css" / "themes.css").read_text(encoding="utf-8"),
             flags=re.S)


def _hex(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def _lum(c):
    def ch(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = map(ch, c)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    hi, lo = sorted((_lum(a), _lum(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


def _mix(a, b, p):
    return tuple(round(x * p + y * (1 - p)) for x, y in zip(a, b))


def _vars(selector_regex):
    """Custom properties of every rule whose selector list matches."""
    out = {}
    for sel, body in re.findall(r"([^{}]+)\{([^{}]*)\}", CSS):
        if re.search(selector_regex, sel):
            out.update(dict(re.findall(r"(--[\w-]+)\s*:\s*([^;]+);", body)))
    return out


def _resolve(value, env):
    value = re.sub(r"/\*.*?\*/", "", value).strip()
    if value.startswith("#"):
        return _hex(value)
    m = re.match(r"color-mix\(in srgb,\s*var\((--[\w-]+)\)\s*(\d+)%,\s*(#[0-9a-fA-F]{6})\)", value)
    if m:
        return _mix(_resolve(env[m.group(1)], env), _hex(m.group(3)), int(m.group(2)) / 100)
    raise AssertionError(f"cannot resolve {value!r}")


THEMES = sorted(set(re.findall(r'\[data-theme="([\w-]+)"\]', CSS)))


def test_all_17_themes_found():
    assert len(THEMES) == 17


@pytest.mark.parametrize("theme", THEMES)
def test_d12_secondary_text_is_readable(theme):
    env = _vars(r"^\s*:root\s*$")
    env.update(_vars(rf'\[data-theme="{theme}"\]'))
    ratio = contrast(_resolve(env["--fg-dim"], env), _resolve(env["--bg-light"], env))
    assert ratio >= 4.5, f"{theme}: {ratio:.2f}"


def test_d11_header_strip_hides_the_matrix_rain():
    """The rain canvas sits behind #app; the note title, tabs and tags
    need an opaque background or the glyphs run right under the text."""
    css = re.sub(r"/\*.*?\*/", "", (ROOT / "static" / "css" / "noirpad.css").read_text(encoding="utf-8"),
                 flags=re.S)
    for sel in ("#top-bar", "#note-header"):   # tabs in #top-bar (G1), tags in #note-header (G3)
        body = re.search(rf"(?m)^{re.escape(sel)}\s*\{{([^}}]*)\}}", css).group(1)
        assert re.search(r"background\s*:\s*var\(--bg\)", body), sel


# ---- G8: the redesign's colour pairs in every theme ----
# Text >= 4.5:1; icons, muted text, folder marks and the danger colour >= 3:1.

def _resolve_any(value, env, depth=0):
    value = re.sub(r"/\*.*?\*/", "", value).strip()
    assert depth < 10, value
    if value.startswith("#"):
        return _hex(value)
    m = re.fullmatch(r"var\((--[\w-]+)\)", value)
    if m:
        return _resolve_any(env[m.group(1)], env, depth + 1)
    m = re.fullmatch(r"color-mix\(in srgb,\s*(.+?)\s+(\d+)%,\s*(.+)\)", value)
    if m:
        return _mix(_resolve_any(m.group(1), env, depth + 1), _resolve_any(m.group(3), env, depth + 1),
                    int(m.group(2)) / 100)
    raise AssertionError(f"cannot resolve {value!r}")


def _theme_env(theme):
    env = _vars(r"^\s*:root\s*$")
    for sel, body in re.findall(r"([^{}]+)\{([^{}]*)\}", CSS):
        if theme in re.findall(r'\[data-theme="([\w-]+)"\]', sel):
            env.update(dict(re.findall(r"(--[\w-]+)\s*:\s*([^;]+);", body)))
    return env


PAIRS = [
    # text
    ("--fg", "--bg", 4.5), ("--fg", "--bg-panel", 4.5), ("--fg", "--bg-light", 4.5),
    ("--fg", "--code-bg", 4.5),
    ("--fg-dim", "--bg", 4.5), ("--fg-dim", "--bg-panel", 4.5), ("--fg-dim", "--bg-light", 4.5),
    ("--fg-bright", "--accent-soft", 4.5),      # selected tree row
    ("--accent", "--accent-soft", 4.5),         # active tab, tag filter
    # muted text (status bar, NOTES / TAGS, section titles, menu shortcuts,
    # placeholders, the trash) is text too: 4.5:1 (U5); red buttons (U7)
    ("--fg-muted", "--bg", 4.5), ("--fg-muted", "--bg-panel", 4.5), ("--fg-muted", "--bg-light", 4.5),
    ("--fg-muted", "--bg-entry", 4.5),
    ("--danger", "--bg", 4.5), ("--danger", "--bg-light", 4.5),
    # icons, marks
    ("--accent", "--bg", 3.0), ("--folder-color", "--bg-panel", 3.0),
    # an "off" switch's outline against the window (U13)
    ("--control-off", "--bg-light", 3.0),
]


PAIRS += [
    # Markdown source (md-source.js): ordinary text and the accent-coloured
    # headings / markup / code, on the editor background.
    ("--md-src-text", "--bg", 4.5), ("--md-src-text", "--bg-entry", 4.5),
    ("--accent", "--bg-entry", 4.5), ("--accent", "--code-bg", 4.5),
    # switch "off" knob on its track
    ("--control-off", "--bg-entry", 3.0),
]


@pytest.mark.parametrize("theme", THEMES)
@pytest.mark.parametrize("fg,bg,need", PAIRS)
def test_g8_redesign_contrast(theme, fg, bg, need):
    env = _theme_env(theme)
    ratio = contrast(_resolve_any(env[fg], env), _resolve_any(env[bg], env))
    assert ratio >= need, f"{theme}: {fg} on {bg} = {ratio:.2f}"


# ---- Review round after G: switches and the Markdown source ----

def _saturation(rgb):
    hi, lo = max(rgb), min(rgb)
    return 0 if hi == 0 else (hi - lo) / hi


@pytest.mark.parametrize("theme", THEMES)
def test_switch_off_state_is_grey_not_accent(theme):
    """An "off" switch must not look "on": grey knob and track, far from the accent."""
    env = _theme_env(theme)
    for var in ("--control-off", "--control-off-track"):
        assert _saturation(_resolve_any(env[var], env)) < 0.12, (theme, var)
    knob, accent = _resolve_any(env["--control-off"], env), _resolve_any(env["--accent"], env)
    assert sum(abs(a - b) for a, b in zip(knob, accent)) > 120, theme


NEON = [t for t in THEMES if t not in ("dracula", "synthwave", "nord", "gruvbox", "tokyo-night")]


@pytest.mark.parametrize("theme", NEON)
def test_markdown_source_text_is_calmer_than_the_accent(theme):
    """Neon themes: --fg is the accent itself, so the source's ordinary text
    is one step calmer and the accent is left for the structure: darker, or
    (dark accents, where darker would fail 4.5:1) clearly greyer."""
    env = _theme_env(theme)
    text, accent = _resolve_any(env["--md-src-text"], env), _resolve_any(env["--accent"], env)
    assert text != accent, theme
    assert _lum(text) < _lum(accent) or _saturation(accent) - _saturation(text) >= 0.15, theme


def test_markdown_source_css_uses_the_tokens():
    css = re.sub(r"/\*.*?\*/", "", (ROOT / "static" / "css" / "noirpad.css").read_text(encoding="utf-8"),
                 flags=re.S)
    hl = re.search(r"(?m)^#md-highlight\s*\{([^}]*)\}", css).group(1)
    assert "var(--md-src-text)" in hl
    assert re.search(r"\.mds-head,\s*#md-highlight \.mds-mark,\s*#md-highlight \.mds-code\s*\{\s*color:\s*var\(--accent\)", css)
    knob = re.search(r"(?m)^\.settings-toggle-knob\s*\{([^}]*)\}", css).group(1)
    assert "var(--control-off)" in knob


# ---- Start page (welcome.js) on the editor background (--bg-entry) ----
WELCOME_PAIRS = [
    ("--fg", "--bg-entry", 4.5),        # action / note names
    ("--fg", "--accent-soft", 4.5),     # focused or hovered row
    ("--fg-dim", "--bg-entry", 4.5),    # tagline, RECENT title, dates, F1 hint
    ("--fg-dim", "--bg-light", 4.5),    # <kbd>
    ("--accent", "--bg-entry", 4.5),    # NOIRPAD, ★
    ("--accent", "--accent-soft", 3.0), # focus ring, icon on a focused row
    ("--fg-muted", "--bg-entry", 3.0),  # row icons
]


@pytest.mark.parametrize("theme", THEMES)
@pytest.mark.parametrize("fg,bg,need", WELCOME_PAIRS)
def test_start_page_contrast(theme, fg, bg, need):
    env = _theme_env(theme)
    ratio = contrast(_resolve_any(env[fg], env), _resolve_any(env[bg], env))
    assert ratio >= need, f"{theme}: {fg} on {bg} = {ratio:.2f}"


# ---- N1.6: falling-code rain behind the note and the start page ----
# With the rain on, #editor-wrapper paints --bg / --bg-entry at --rain-veil
# over the canvas. Worst case under a letter: the brightest glyph
# (--fg-bright, the head of a column) or the canvas' own dark trail fill.
RAIN_PAIRS = [
    ("--fg", "--bg", 4.5), ("--fg-dim", "--bg", 4.5), ("--fg-muted", "--bg", 4.5),
    ("--md-src-text", "--bg", 4.5), ("--accent", "--bg", 4.5),   # no --danger text in these areas
    ("--fg", "--bg-entry", 4.5), ("--fg-dim", "--bg-entry", 4.5), ("--accent", "--bg-entry", 4.5),
    ("--fg-muted", "--bg-entry", 3.0),
]
RAIN_TRAIL = "#0a0a0a"   # matrix-rain.js: rgba(10, 10, 10, 0.15) every frame


def _veil(env):
    m = re.fullmatch(r"(\d+)%", env["--rain-veil"].strip())
    assert m, env["--rain-veil"]
    return int(m.group(1)) / 100


@pytest.mark.parametrize("theme", THEMES)
@pytest.mark.parametrize("fg,bg,need", RAIN_PAIRS)
def test_rain_veil_keeps_text_readable(theme, fg, bg, need):
    env = _theme_env(theme)
    text, base = _resolve_any(env[fg], env), _resolve_any(env[bg], env)
    for glyph in (_resolve_any(env["--fg-bright"], env), _hex(RAIN_TRAIL)):
        under = _mix(base, glyph, _veil(env))
        ratio = contrast(text, under)
        assert ratio >= need, f"{theme}: {fg} on {bg} over the rain = {ratio:.2f}"


@pytest.mark.parametrize("theme", THEMES)
def test_rain_veil_still_shows_the_rain(theme):
    """The fix must not hide the rain again: at least 5 % of it comes through."""
    assert _veil(_theme_env(theme)) <= 0.95, theme


def test_rain_uses_the_veil_token_and_theme_colours():
    css = re.sub(r"/\*.*?\*/", "", (ROOT / "static" / "css" / "noirpad.css").read_text(encoding="utf-8"),
                 flags=re.S)
    rules = re.findall(r"(?m)^body\.np-rain-on #editor-wrapper[^{]*\{([^}]*)\}", css)
    assert len(rules) == 2
    for body in rules:
        assert re.search(r"background:\s*color-mix\(in srgb,\s*var\(--bg(-entry)?\)\s+var\(--rain-veil\),\s*transparent\)", body)
    js = (ROOT / "static" / "js" / "matrix-rain.js").read_text(encoding="utf-8")
    # The brightest colour the rain draws is --fg-bright (the test above).
    assert set(re.findall(r'getPropertyValue\("(--[\w-]+)"\)', js)) == {"--fg-bright", "--fg", "--fg-dim"}
    assert "rgba(10, 10, 10, 0.15)" in js
