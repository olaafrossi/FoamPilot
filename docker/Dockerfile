FROM ubuntu:24.04

LABEL org.opencontainers.image.source="https://github.com/olaafrossi/FoamPilot"
LABEL org.opencontainers.image.description="FoamPilot OpenFOAM backend"

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
COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir --break-system-packages -r /tmp/requirements.txt && \
    rm /tmp/requirements.txt

# ── Non-root user ────────────────────────────────────────────────────
RUN useradd -m -s /bin/bash openfoam && \
    mkdir -p /home/openfoam/run && \
    chown -R openfoam:openfoam /home/openfoam

ENV FOAM_RUN=/home/openfoam/run
ENV FOAM_TEMPLATES=/opt/foampilot/templates

# ── Templates ────────────────────────────────────────────────────────
COPY --chown=openfoam:openfoam templates/ /opt/foampilot/templates/

# ── Stock OpenFOAM tutorials for setup verification ──────────────────
# Copy case files from installed OpenFOAM, then our template.json overlays
RUN for tut in airFoil2D motorBike; do \
        src="/usr/lib/openfoam/openfoam2512/tutorials/incompressible/simpleFoam/$tut"; \
        dst="/opt/foampilot/templates/tutorials/incompressible/simpleFoam/$tut"; \
        if [ -d "$src" ]; then \
            cp -rn "$src"/. "$dst"/ ; \
            chown -R openfoam:openfoam "$dst"; \
        fi; \
    done

# ── Backend ──────────────────────────────────────────────────────────
COPY backend/ /app/
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && chown -R openfoam:openfoam /app

WORKDIR /app
EXPOSE 8000

USER openfoam
ENTRYPOINT ["/entrypoint.sh"]
