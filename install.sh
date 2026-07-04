#!/bin/bash

echo "🚀 Installing VPS Bot..."

# Update system
apt update -y && apt upgrade -y -q

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Install PM2
npm install -g pm2

# Install Docker
curl -fsSL https://get.docker.com | bash
systemctl start docker
systemctl enable docker

# Install dependencies
mkdir -p "/vps"
cd /vps
npm install

# Build Docker images
docker build -t ubuntu-vps:22.04 -f Dockerfile.ubuntu22 .
docker build -t ubuntu-vps:24.04 -f Dockerfile.ubuntu24 .
docker build -t debian-vps:11 -f Dockerfile.debian11 .
docker build -t debian-vps:12 -f Dockerfile.debian12 .
docker build -t debian-vps:13 -f Dockerfile.debian13 .

# Start bot with PM2
pm2 start bot.js --name vps-bot
pm2 save

echo "✅ Installation complete!"
pm2 status
