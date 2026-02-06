# Use Node.js 18 Alpine as base image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies for building)
RUN npm ci

# Copy source code
COPY src/ ./src/
COPY tsconfig.json ./

# Build the TypeScript application
RUN npm run build

# Remove dev dependencies to reduce image size
RUN npm prune --production

# Expose port if needed (though MCP uses stdio, might need HTTP for some clients)
EXPOSE 3000

# Set environment variables for HTTP mode
ENV MCP_MODE=http
ENV PORT=3000
ENV HOST=0.0.0.0

# GA4 Analytics (optional - set at runtime to enable)
# ENV GA_MEASUREMENT_ID=
# ENV GA_API_SECRET=

# Run the application
CMD ["npm", "start"]