FROM debian:trixie-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates coreutils git \
  && rm -rf /var/lib/apt/lists/*

# The runner only takes commands through exec, so the main process waits.
CMD ["sleep", "infinity"]
