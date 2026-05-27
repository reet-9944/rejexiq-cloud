# Stage 1: Build the frontend (Vite React App)
FROM node:20-alpine AS build
WORKDIR /app

# Copy root package.json and install frontend dependencies
COPY package*.json ./
RUN npm ci

# Copy the rest of the application
COPY . .

# Build the frontend
RUN npm run build

# Stage 2: Setup the production environment
FROM node:20-alpine
WORKDIR /app

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8080

# Copy root package files and install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy backend package files and install backend dependencies
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev

# Copy the backend source code
COPY backend/ ./backend/

# Copy the built frontend from the previous stage
COPY --from=build /app/dist ./dist

# Create uploads directory (used by multer in server.js)
RUN mkdir -p backend/uploads && chmod -R 777 backend/uploads

# Expose the Cloud Run default port
EXPOSE 8080

# Start the application
CMD ["npm", "run", "server"]
