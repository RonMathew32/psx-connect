#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}PSX Connect Tests${NC}"
echo "===================="
echo ""

# Check if ts-node is available
if ! command -v npx &> /dev/null; then
    echo -e "${RED}Error: npx is not installed. Please install Node.js and npm first.${NC}"
    exit 1
fi

# Function to run a test
run_test() {
    local test_name=$1
    local test_file=$2
    
    echo -e "${BLUE}Running Test: ${test_name}${NC}"
    echo -e "${YELLOW}------------------------------------${NC}"
    npx ts-node $test_file
    echo -e "${YELLOW}------------------------------------${NC}"
    echo ""
}

# Format and display a FIX logon message
run_test "Format FIX Message" "src/examples/format-fix-message.ts"

# Ask user if they want to try connecting to PSX
echo -e "${BLUE}Do you want to try connecting to PSX? (y/N)${NC}"
read -r answer

if [[ "$answer" =~ ^[Yy]$ ]]; then
    # Run the connection test
    run_test "PSX Connection Test" "src/examples/psx-connection-test.ts"
fi

echo ""
echo -e "${GREEN}Tests completed!${NC}" 