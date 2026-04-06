import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import init_db
from app.services.seed import seed_if_empty
from app.spatial.lazy import is_poi_loaded, get_poi_count
from app.routers import upload, poi, clusters, map_data, analytics, events, live

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Initializing database...")
    init_db()
    try:
        seed_if_empty()
    except Exception:
        logger.exception("Seed failed — server will start without pre-loaded data")
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
    return {
        "status": "ok",
        "poi_count": get_poi_count(),
        "poi_loaded": is_poi_loaded(),
        "db_status": "connected",
    }
