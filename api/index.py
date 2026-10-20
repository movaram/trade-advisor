"""Vercel entrypoint for the Python backend. Vercel runs every .py file in the root api/ folder as
a serverless function next to the Next.js site; vercel.json rewrites all /api/* requests here.
The actual app lives in backend/ (so it still runs locally with uvicorn) and is imported as-is."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))

from main import app  # noqa: E402,F401  -- Vercel looks for a top-level `app`
