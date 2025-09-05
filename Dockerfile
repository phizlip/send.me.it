FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Create necessary directories
RUN mkdir -p frontend server

# Expose ports
EXPOSE 8080 9000

# Start the application
CMD ["npm", "start"]
