FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
COPY docker-entrypoint.sh /usr/local/bin/market-stack-backend-entrypoint
RUN chmod +x /usr/local/bin/market-stack-backend-entrypoint \
    && rm -rf /app/data \
    && ln -s /data /app/data

EXPOSE 8004

ENTRYPOINT ["market-stack-backend-entrypoint"]
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8004"]
