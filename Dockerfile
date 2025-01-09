FROM node:18-slim

# Install required packages
RUN apt-get update && \
    apt-get install -y sqlite3 curl && \
    rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy app source
COPY . .

# Create data directory and set permissions
RUN mkdir -p /usr/src/app/data && \
    chown -R 1000:1000 /usr/src/app && \
    chmod -R 755 /usr/src/app/data

# Set NODE_ENV at build time
ENV NODE_ENV=production

# Expose port (this is just documentation)
EXPOSE 3000

# Add healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${PORT:-3000}/ || exit 1

# Switch to non-root user
USER 1000

# Start the application
CMD ["npm", "start"] 