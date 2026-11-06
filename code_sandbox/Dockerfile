FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/tmp \
    PYTHONSAFEPATH=1 \
    ANANTA_GUEST_ROOT=/var/ananta-guests

# One unprivileged account per exec slot. main.py SLOT_COUNT is 2, so the
# uids are 61001 and 61002. The runner stays root and setuids per exec.
RUN set -eux; \
    for i in 0 1; do \
      uid=$((61001 + i)); \
      groupadd --system --gid "$uid" "ananta-slot${i}"; \
      useradd --system --uid "$uid" --gid "$uid" \
        --no-create-home --shell /usr/sbin/nologin "ananta-slot${i}"; \
    done

WORKDIR /opt/ananta-code
COPY bridge.py main.py /opt/ananta-code/
COPY entrypoint.sh /usr/local/bin/ananta-code-entrypoint
RUN chmod 755 /usr/local/bin/ananta-code-entrypoint \
    && chmod 644 /opt/ananta-code/bridge.py /opt/ananta-code/main.py

USER root
ENTRYPOINT ["ananta-code-entrypoint"]
