FROM node:24-trixie-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

# The runner only takes commands through exec, so the main process waits.
CMD ["sleep", "infinity"]
