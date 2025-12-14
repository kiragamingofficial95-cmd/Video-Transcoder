FROM node:20-slim

# Install FFmpeg
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm install --include=dev

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Create storage directories
RUN mkdir -p /tmp/storage/chunks /tmp/storage/uploads /tmp/storage/transcoded

# Expose port (Render will set PORT env var)
EXPOSE 10000

# Start the application
CMD ["npm", "start"]
