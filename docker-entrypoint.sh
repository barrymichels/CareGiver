#!/bin/sh
set -e

# These operations need to be run as root
if [ "$(id -u)" = "0" ]; then
    # Ensure data directory exists and has correct permissions
    mkdir -p /usr/src/app/data
    touch /usr/src/app/data/database.sqlite
    chown -R node:node /usr/src/app/data /usr/src/app/data/database.sqlite
    chmod 755 /usr/src/app/data
    chmod 644 /usr/src/app/data/database.sqlite
    
    # Switch to node user and execute the command
    exec gosu node "$@"
else
    # If we're already running as node, just execute the command
    exec "$@"
fi 