"""API routers, one module per area. Included by noirpad.app."""

from . import (app_lock, backup, data, desktop, encryption, export, images, notes, session,
               settings, store, tree)

ROUTERS = [session.router, app_lock.router, data.router, tree.router, notes.router,
           settings.router, encryption.router, images.router, export.router, backup.router,
           desktop.router, store.router]
