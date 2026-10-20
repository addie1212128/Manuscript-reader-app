# Optional: a container image for hosts other than Render's native Node runtime
# (Fly.io, Google Cloud Run, Railway, a VPS…). It includes ffmpeg, so audio
# chunks are stitched together gaplessly. Render's native Node path does not
# need this file — the app falls back to byte-concatenation without ffmpeg.
FROM node:22-slim

# ffmpeg gives clean, gapless stitching of the audio chunks.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Drop root: run as the unprivileged "node" user the base image provides.
USER node

CMD ["npm", "start"]
