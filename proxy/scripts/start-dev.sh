#!/bin/bash

# Load parent .env if it exists
if [ -f "../.env" ]; then
  echo "Loading API key from parent .env..."
  export $(grep ANTHROPIC_API_KEY ../.env | xargs)
fi

# Start the proxy server
npm run dev
