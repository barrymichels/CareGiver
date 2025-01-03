#!/bin/sh

# Ensure data directory exists and has correct permissions
mkdir -p /usr/src/app/data
touch /usr/src/app/data/database.sqlite
chown -R node:node /usr/src/app/data
chmod 755 /usr/src/app/data
chmod 644 /usr/src/app/data/database.sqlite

# Execute the main container command
exec "$@" 