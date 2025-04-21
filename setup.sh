#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}PSX Connect Setup${NC}"
echo "==========================="
echo ""

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo -e "${RED}Error: npm is not installed. Please install Node.js and npm first.${NC}"
    exit 1
fi

# Install dependencies
echo -e "${YELLOW}Installing dependencies...${NC}"
npm install

# Create logs directory
echo -e "${YELLOW}Creating logs directory...${NC}"
mkdir -p logs

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo -e "${YELLOW}Creating .env file...${NC}"
    cp .env.example .env
    echo -e "${GREEN}Created .env file. Please edit it with your PSX credentials.${NC}"
else
    echo -e "${YELLOW}.env file already exists. Skipping...${NC}"
fi

# Compile TypeScript
echo -e "${YELLOW}Compiling TypeScript...${NC}"
npm run build

echo ""
echo -e "${GREEN}Setup completed successfully!${NC}"
echo ""
echo "You can now start the PSX Connect application:"
echo "  npm start"
echo ""
echo "For development with auto-reload:"
echo "  npm run dev"
echo "" 