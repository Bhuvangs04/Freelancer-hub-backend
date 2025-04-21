FROM node:18

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the code
COPY . .

# Expose backend port (change if different)
EXPOSE 3000
EXPOSE 9000


# Start the backend
CMD ["npm", "start"]
