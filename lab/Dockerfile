FROM oven/bun:1.2

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    git \
    sqlite3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace/poko

CMD ["bash"]
