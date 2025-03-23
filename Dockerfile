# Use the official Node.js 18 image from the Docker Hub as the base image
FROM node:18

# Update the package list and install ffmpeg dependencies
RUN apt-get update && \
    apt-get install -y ffmpeg && \
    rm -rf /var/lib/apt/lists/* # Clean up to reduce image size

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (if it exists) for npm install
COPY package*.json ./

# Install dependencies from the package.json file
RUN npm install

# Update dependencies to their latest compatible versions
RUN npm update

# Copy the rest of the application code into the container
COPY . .

# Expose port 3000 (adjust if your app uses a different port)
EXPOSE 3000

# Command to run your Node.js application
CMD ["node", "index.js"]
