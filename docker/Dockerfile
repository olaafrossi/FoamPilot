FROM ubuntu:24.04

ARG DEBIAN_FRONTEND=noninteractive

# ── System packages ──────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg software-properties-common \
        wget apt-transport-https && \
    rm -rf /var/lib/apt/lists/*

# ── OpenFOAM v2512 from ESI openfoam.com ─────────────────────────────
RUN curl -fsSL https://dl.openfoam.com/add-debian-repo.sh | bash && \
    apt-get update && apt-get install -y --no-install-recommends \
        openfoam2512-default && \
    rm -rf /var/lib/apt/lists/*

# ── Python 3.11 + pip ────────────────────────────────────────────────
RUN add-apt-repository -y ppa:deadsnakes/ppa && \
    apt-get update && apt-get install -y --no-install-recommends \
        python3.11 python3.11-venv python3.11-dev python3-pip && \
    rm -rf /var/lib/apt/lists/* && \
    update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1

# ── Python dependencies ──────────────────────────────────────────────
RUN pip install --no-cache-dir --break-system-packages \
        fastapi uvicorn[standard] websockets python-multipart

# ── Non-root user ────────────────────────────────────────────────────
RUN useradd -m -s /bin/bash openfoam && \
    mkdir -p /home/openfoam/run /home/openfoam/templates && \
    chown -R openfoam:openfoam /home/openfoam

ENV FOAM_RUN=/home/openfoam/run

# ── Backend ──────────────────────────────────────────────────────────
COPY backend/ /app/
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && chown -R openfoam:openfoam /app

WORKDIR /app
EXPOSE 8000

USER openfoam
ENTRYPOINT ["/entrypoint.sh"]
