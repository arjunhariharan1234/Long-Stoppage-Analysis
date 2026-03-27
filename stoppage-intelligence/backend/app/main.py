import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import POI_CSV_PATH
from app.database import init_db
from app.spatial.index import POISpatialIndex
from app.routers import upload, poi, clusters, map_data, analytics, events

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

    logger.info("Loading POI spatial index...")
    app.state.poi_index = POISpatialIndex(POI_CSV_PATH)
    logger.info("Startup complete. POI index has %d entries.", len(app.state.poi_index.pois))

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


@app.get("/api/health")
def health_check():
    poi_count = len(app.state.poi_index.pois) if hasattr(app.state, "poi_index") else 0
    return {
        "status": "ok",
        "poi_count": poi_count,
        "db_status": "connected",
    }
