FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/tmp \
    PYTHONSAFEPATH=1

# stdlib only. nobody already exists in the Debian slim image; the fallback
# covers a base image that does not ship it.
RUN id nobody >/dev/null 2>&1 || useradd --system --uid 65534 --no-create-home nobody

WORKDIR /opt/ananta-code
COPY bridge.py main.py /opt/ananta-code/
COPY entrypoint.sh /usr/local/bin/ananta-code-entrypoint
RUN chmod 755 /usr/local/bin/ananta-code-entrypoint \
    && chmod 644 /opt/ananta-code/bridge.py /opt/ananta-code/main.py

USER root
ENTRYPOINT ["ananta-code-entrypoint"]
