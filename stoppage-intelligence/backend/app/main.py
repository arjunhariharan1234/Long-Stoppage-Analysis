import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import POI_CSV_PATH
from app.database import init_db
from app.spatial.index import POISpatialIndex
from app.routers import upload, poi, clusters, map_data, analytics, events, live

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger(__name__)

_poi_index: POISpatialIndex | None = None
_poi_lock = threading.Lock()


def get_poi_index() -> POISpatialIndex:
    """Lazy-load the POI spatial index on first use."""
    global _poi_index
    if _poi_index is None:
        with _poi_lock:
            if _poi_index is None:
                logger.info("Loading POI spatial index (first use)...")
                _poi_index = POISpatialIndex(POI_CSV_PATH)
                logger.info("POI index loaded: %d entries.", len(_poi_index.pois))
    return _poi_index


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Initializing database...")
    init_db()
    logger.info("Startup complete. POI index will load on first use.")

    yield

    # Shutdown
    logger.info("Shutting down.")


app = FastAPI(
    title="Stoppage Intelligence Platform",
    description="Location intelligence for stoppage analysis",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(upload.router, prefix="/api")
app.include_router(poi.router, prefix="/api")
app.include_router(clusters.router, prefix="/api")
app.include_router(map_data.router, prefix="/api")
app.include_router(analytics.router, prefix="/api")
app.include_router(events.router, prefix="/api")
app.include_router(live.router, prefix="/api")


@app.get("/api/health")
def health_check():
    poi_loaded = _poi_index is not None
    return {
        "status": "ok",
        "poi_count": len(_poi_index.pois) if poi_loaded else 0,
        "poi_loaded": poi_loaded,
        "db_status": "connected",
    }
