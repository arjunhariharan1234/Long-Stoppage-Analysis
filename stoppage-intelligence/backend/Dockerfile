FROM python:3.13-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/

# Copy POI data from project root
COPY ../india_all_pois.csv /data/india_all_pois.csv

ENV POI_CSV_PATH=/data/india_all_pois.csv

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
