#!/bin/bash

echo "🚀 Installing VPS Bot..."

apt update -y && apt upgrade -y -q

curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

npm install -g pm2

curl -fsSL https://get.docker.com | bash
systemctl start docker
systemctl enable docker

cd /root/bot-cvps
npm install

docker build -t ubuntu-vps:22.04 -f docker/os/Dockerfile.ubuntu22 .
docker build -t ubuntu-vps:24.04 -f docker/os/Dockerfile.ubuntu24 .
docker build -t debian-vps:11 -f docker/os/Dockerfile.debian11 .
docker build -t debian-vps:12 -f docker/os/Dockerfile.debian12 .
docker build -t debian-vps:13 -f docker/os/Dockerfile.debian13 .

pm2 start bot.js --name vps-bot
pm2 save

echo "✅ Installation complete!"
pm2 status
