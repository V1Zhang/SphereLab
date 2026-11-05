FROM nvidia/cuda:12.4.1-devel-ubuntu22.04 AS renderer-build

ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /build
RUN rm -f /etc/apt/sources.list.d/cuda*.list \
  && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/* /tmp/* \
  && sed -i 's|http://archive.ubuntu.com/ubuntu|https://mirrors.tuna.tsinghua.edu.cn/ubuntu|g; s|http://security.ubuntu.com/ubuntu|https://mirrors.tuna.tsinghua.edu.cn/ubuntu|g' /etc/apt/sources.list \
  && apt-get -o Acquire::Retries=3 update \
  && apt-get install -y --no-install-recommends ffmpeg build-essential \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/* /tmp/*
COPY native ./native
RUN mkdir -p /out \
  && nvcc -O2 -std=c++17 native/spherelab-renderer.cu -o /out/spherelab-renderer

FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /opt/spherelab

RUN rm -f /etc/apt/sources.list.d/cuda*.list \
  && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/* /tmp/* \
  && sed -i 's|http://archive.ubuntu.com/ubuntu|https://mirrors.tuna.tsinghua.edu.cn/ubuntu|g; s|http://security.ubuntu.com/ubuntu|https://mirrors.tuna.tsinghua.edu.cn/ubuntu|g' /etc/apt/sources.list \
  && apt-get -o Acquire::Retries=3 update \
  && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg \
  && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y --no-install-recommends nodejs npm \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/* /tmp/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
RUN mkdir -p /opt/spherelab/bin
COPY --from=renderer-build /out/spherelab-renderer /opt/spherelab/bin/spherelab-renderer
RUN chmod +x /opt/spherelab/bin/spherelab-renderer

ENV SPHERELAB_PORT=8787
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node src/index.mjs --health >/dev/null || exit 1
CMD ["node", "src/index.mjs"]
