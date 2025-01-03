#!/bin/bash

# Create data directory if it doesn't exist
mkdir -p ./data

# Set directory ownership to match the container's user (UID 1000)
sudo chown -R 1000:1000 ./data

# Set directory permissions
sudo chmod 755 ./data

# Create empty database file if it doesn't exist
touch ./data/database.sqlite

# Set database file permissions
sudo chown 1000:1000 ./data/database.sqlite
sudo chmod 644 ./data/database.sqlite

echo "Local environment initialized successfully"
echo "You can now run: docker-compose up -d" 