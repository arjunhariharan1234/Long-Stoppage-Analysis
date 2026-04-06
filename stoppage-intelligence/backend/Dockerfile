FROM python:3.13-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/

# Copy compressed POI dataset
COPY data/india_all_pois.csv.gz ./data/india_all_pois.csv.gz

# Ensure upload and data directories exist
RUN mkdir -p ./data/uploads

ENV POI_CSV_PATH=/app/data/india_all_pois.csv.gz
ENV DATABASE_URL=sqlite:////app/data/stoppage_intelligence.db
ENV UPLOAD_DIR=/app/data/uploads

EXPOSE 8000

CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
