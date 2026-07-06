#!/bin/bash
set -e

apt update -y

if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
fi

if ! command -v pm2 &> /dev/null; then
    npm install -g pm2
fi

if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com | bash
    systemctl enable --now docker
fi

mkdir -p /data
chmod 777 /data

cd "$(dirname "$0")"

if [ ! -d "node_modules" ]; then
    npm install --production
fi

cd docker

if [ -z "$(docker images -q ubuntu-vps:22.04)" ]; then
    docker build -t ubuntu-vps:22.04 -f Dockerfile.ubuntu22 .
fi

if [ -z "$(docker images -q ubuntu-vps:24.04)" ]; then
    docker build -t ubuntu-vps:24.04 -f Dockerfile.ubuntu24 .
fi

if [ -z "$(docker images -q debian-vps:11)" ]; then
    docker build -t debian-vps:11 -f Dockerfile.debian11 .
fi

if [ -z "$(docker images -q debian-vps:12)" ]; then
    docker build -t debian-vps:12 -f Dockerfile.debian12 .
fi

if [ -z "$(docker images -q debian-vps:13)" ]; then
    docker build -t debian-vps:13 -f Dockerfile.debian13 .
fi

cd ..

if ! pm2 list | grep -q "vps-bot"; then
    pm2 start bot.js --name vps-bot
    pm2 save
    pm2 startup -y
else
    pm2 restart vps-bot
fi

pm2 status
