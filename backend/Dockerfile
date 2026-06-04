FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

WORKDIR /app

COPY requirements.txt .
RUN grep -v '^winloop==' requirements.txt > requirements-linux.txt \
    && pip install --no-cache-dir -r requirements-linux.txt

COPY . .
COPY docker-entrypoint.sh /usr/local/bin/ananta-market-stack-backend-entrypoint
RUN sed -i 's/\r$//' /usr/local/bin/ananta-market-stack-backend-entrypoint \
    && chmod +x /usr/local/bin/ananta-market-stack-backend-entrypoint \
    && rm -rf /app/data \
    && ln -s /data /app/data

EXPOSE 8000

ENTRYPOINT ["ananta-market-stack-backend-entrypoint"]
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
