#!/bin/bash
# Absolute path to this directory
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Set up the paths
export DYLD_LIBRARY_PATH="$DIR/lib:/Volumes/ROCSDK/lib"

# Start the application
exec npm run start:dev
