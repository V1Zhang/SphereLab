FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /opt/spherelab

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg gstreamer1.0-tools \
    gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-bad \
    gstreamer1.0-libav libegl1 libgl1 libgles2 build-essential \
  && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
COPY native ./native

RUN mkdir -p /opt/spherelab/bin \
  && c++ -O2 -std=c++17 native/spherelab-renderer.cpp -o /opt/spherelab/bin/spherelab-renderer \
  && chmod +x /opt/spherelab/bin/spherelab-renderer

ENV SPHERELAB_PORT=8787
EXPOSE 8787
CMD ["node", "src/index.mjs"]
