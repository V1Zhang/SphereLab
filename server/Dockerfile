FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /opt/spherelab

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg gstreamer1.0-tools \
  && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY src ./src

ENV SPHERELAB_PORT=8787
EXPOSE 8787
CMD ["node", "src/index.mjs"]
