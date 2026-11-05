"""The FastAPI application.

Importing this module points the backend at the data directory (see
config.get_data_dir), so ``uvicorn noirpad.app:app`` works on its own.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import config, desktop_save, images, scrub, server_auth, storage
from .__version__ import __version__
from .errors import ApiError
from .routes import ROUTERS

log = logging.getLogger("noirpad")

if not config.is_frozen():
    config.STATIC_DIR.mkdir(exist_ok=True)  # a fresh checkout must not crash

storage.set_data_dir(config.get_data_dir())


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    try:
        images.collect_orphans()
    except Exception:  # cleanup must never keep NoirPad from starting
        log.exception("Image cleanup failed")
    scrub.start()
    yield
    scrub.stop()


# No interactive API docs: this is a local app, not a public API.
app = FastAPI(title="NoirPad", version=__version__, lifespan=_lifespan,
              docs_url=None, redoc_url=None, openapi_url=None)

# Browsers keep icons in a cache of their own (favicon, installed web app),
# whatever the no-store header says. index.html and manifest.json write this
# mark into the icon URLs and get the version here: a release with a new logo
# shows it, and the version stays in __version__.py only.
VERSION_MARK = "__NP_VERSION__"


def _with_version(path) -> str:
    return path.read_text(encoding="utf-8").replace(VERSION_MARK, __version__)


# Before the /static mount, which would serve the file without the version.
@app.api_route("/static/manifest.json", methods=["GET", "HEAD"])   # HEAD like StaticFiles
def manifest():
    path = config.STATIC_DIR / "manifest.json"
    if not path.exists():
        raise ApiError(404, "file_not_found")
    return Response(_with_version(path), media_type="application/manifest+json")


# No CORSMiddleware on purpose: the frontend is same-origin, and no other
# origin may call the API.
app.mount("/static", StaticFiles(directory=str(config.STATIC_DIR)), name="static")


@app.middleware("http")
async def _http_guard(request: Request, call_next):
    response = server_auth.check_request(request)
    if response is None:
        try:
            response = await call_next(request)
        except Exception:
            # S4: an unexpected error still gets the security headers (CSP,
            # nosniff, no-store) — and the page its usual error shape.
            log.exception("Unhandled error in %s %s", request.method, request.url.path)
            response = JSONResponse({"detail": {"code": "generic", "params": {"status": 500}}},
                                    status_code=500)
        if desktop_save.wants_native_save(request):
            response = await desktop_save.save_response(response)
    server_auth.apply_security_headers(request, response)
    return response


@app.get("/", response_class=HTMLResponse)
def root():
    index = config.STATIC_DIR / "index.html"
    if not index.exists():
        raise ApiError(404, "index_missing")
    return _with_version(index)


for _router in ROUTERS:
    app.include_router(_router)
