FROM node:18-slim

# Install SQLite tools
RUN apt-get update && apt-get install -y sqlite3 && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy app source
COPY . .

# Create volume directory for database and set permissions
RUN mkdir -p /usr/src/app/data && \
    chown -R node:node /usr/src/app/data && \
    chmod 755 /usr/src/app/data

# Switch to non-root user
USER node

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/usr/src/app/data/database.sqlite

# Expose port
EXPOSE 3000

# Add healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/ || exit 1

# Start the application
CMD ["npm", "start"] 