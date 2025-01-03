#!/bin/bash

# Create data directory if it doesn't exist
mkdir -p ./data

# Set proper permissions for data directory
chmod 755 ./data

# Create empty database file if it doesn't exist
touch ./data/database.sqlite
chmod 644 ./data/database.sqlite

echo "Local environment initialized successfully"
echo "You can now run: docker-compose up -d" 