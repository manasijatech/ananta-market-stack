FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    PIP_DEFAULT_TIMEOUT=100 \
    PIP_RETRIES=10 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY requirements.txt .
RUN grep -v '^winloop==' requirements.txt > requirements-linux.txt \
    && pip install --no-cache-dir --upgrade pip \
    && ( \
         pip install --no-cache-dir --prefer-binary -r requirements-linux.txt \
         || (echo "pip install failed (attempt 1/5), retrying..." && sleep 5 \
             && pip install --no-cache-dir --prefer-binary -r requirements-linux.txt) \
         || (echo "pip install failed (attempt 2/5), retrying..." && sleep 10 \
             && pip install --no-cache-dir --prefer-binary -r requirements-linux.txt) \
         || (echo "pip install failed (attempt 3/5), retrying..." && sleep 15 \
             && pip install --no-cache-dir --prefer-binary -r requirements-linux.txt) \
         || (echo "pip install failed (attempt 4/5), retrying..." && sleep 20 \
             && pip install --no-cache-dir --prefer-binary -r requirements-linux.txt) \
       )

COPY . .
COPY docker-entrypoint.sh /usr/local/bin/ananta-market-stack-backend-entrypoint
RUN sed -i 's/\r$//' /usr/local/bin/ananta-market-stack-backend-entrypoint \
    && chmod +x /usr/local/bin/ananta-market-stack-backend-entrypoint \
    && rm -rf /app/data \
    && ln -s /data /app/data

EXPOSE 8000

ENTRYPOINT ["ananta-market-stack-backend-entrypoint"]
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
