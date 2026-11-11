"""Session: run mode, server-mode password login, desktop cookie bind."""

import secrets
import time

from fastapi import APIRouter, Request, Response

from .. import app_lock, config, edition, storage
from .. import server_auth as auth
from ..__version__ import AUTHOR, CONTACT_EMAIL, COPYRIGHT, PROJECT_URL, __version__
from ..errors import ApiError
from ..models import LoginReq
from ..runtime import RUNTIME
from ..storage import read_data

router = APIRouter()


@router.get("/api/session")
def session_info(request: Request):
    authenticated = auth.is_authenticated(request)
    return {
        "mode": RUNTIME.mode,
        "password_required": RUNTIME.mode == "server" and bool(RUNTIME.password),
        "authenticated": authenticated,
        "data_notice": RUNTIME.data_notice if authenticated else None,
        "app_lock": {"enabled": app_lock.enabled(),
                     "unlocked": app_lock.is_unlocked(request)},
        # Needed before login / app lock, so the gate is in the right language.
        "language": read_data().get("language", "auto"),
        # The installer's language: what "auto" means in the desktop app.
        "install_language": config.install_language(storage.DATA_DIR),
    }


@router.get("/api/version")
def version():
    """For the About box, the start page and bug reports (noirpad/__version__.py)."""
    return {"version": __version__, "url": PROJECT_URL, "author": AUTHOR,
            "copyright": COPYRIGHT, "contact": CONTACT_EMAIL, "edition": edition.edition()}


# Shipped next to the app (noirpad.spec datas, installer.iss [Files]).
LICENSE_FILES = {"license": "LICENSE", "notices": "THIRD-PARTY-NOTICES.txt"}


@router.get("/api/licenses")
def licenses():
    """N8: About → Licenses. NoirPad's own LICENSE and the third-party notices."""
    out = {}
    for key, name in LICENSE_FILES.items():
        try:
            out[key] = config.resource_path(name).read_text(encoding="utf-8")
        except OSError:
            raise ApiError(404, "licenses_missing")
    return out


@router.post("/api/session/dismiss-notice")
def dismiss_notice():
    from .. import store_import
    if RUNTIME.data_notice and RUNTIME.data_notice.get("code") == store_import.NOTICE_DONE:
        store_import.mark_notice_shown(storage.DATA_DIR)     # shown once (N1.9)
    RUNTIME.data_notice = None
    return {"ok": True}


@router.post("/api/session/bind")
def session_bind(response: Response):
    """Desktop: turn the header token into a cookie for <img> requests.

    Only reachable with a valid X-NoirPad-Token (see check_request).
    """
    if RUNTIME.mode == "desktop" and RUNTIME.desktop_token:
        response.set_cookie(
            key=auth.DESKTOP_COOKIE_NAME, value=RUNTIME.desktop_token,
            httponly=True, samesite="strict", path="/images/",
        )
    return {"ok": True}


@router.post("/api/login")
def login(req: LoginReq, response: Response):
    if not (RUNTIME.mode == "server" and RUNTIME.password):
        return {"ok": True}
    now = time.time()
    with auth.guarded_attempt(RUNTIME.login_failures):
        if len(req.password) > 1024 or not auth.password_matches(req.password):
            raise ApiError(401, "wrong_password")
    token = secrets.token_urlsafe(32)
    ttl = auth.SESSION_TTL_REMEMBER if req.remember else auth.SESSION_TTL_SHORT
    RUNTIME.sessions[token] = now + ttl
    auth.set_session_cookie(response, token, remember=req.remember)
    return {"ok": True}


@router.post("/api/logout")
def logout(request: Request, response: Response):
    RUNTIME.sessions.pop(request.cookies.get(auth.SESSION_COOKIE_NAME) or "", None)
    response.delete_cookie(key=auth.SESSION_COOKIE_NAME, path="/", samesite="strict",
                           secure=auth.SESSION_COOKIE_SECURE)
    return {"ok": True}
