FROM node:20-alpine

WORKDIR /app

# Install only production deps for a slim image.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Copy the rest of the source.
COPY . .

# Persistent state lives in /app/data; mount a volume to /app/data to survive
# rebuilds.
ENV DATA_DIR=/app/data
ENV HOST=0.0.0.0
ENV PORT=8080

EXPOSE 8080
CMD ["node", "server.js"]
