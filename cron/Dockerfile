FROM denoland/deno:2.0.0

WORKDIR /app
COPY . .

# Pre-cache the script for faster cold starts
RUN deno cache indexer.ts

CMD ["deno", "run", "--allow-net", "--allow-env=INDEXER_SECRET", "indexer.ts"]
