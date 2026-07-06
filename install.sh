#!/bin/bash
set -e

apt update -y
apt upgrade -y -q

curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

npm install -g pm2

curl -fsSL https://get.docker.com | bash
systemctl enable --now docker

cd /cvps
npm install --production

cd /cvps/docker
docker build -t ubuntu-vps:22.04 -f Dockerfile.ubuntu22 .
docker build -t ubuntu-vps:24.04 -f Dockerfile.ubuntu24 .
docker build -t debian-vps:11  -f Dockerfile.debian11 .
docker build -t debian-vps:12  -f Dockerfile.debian12 .
docker build -t debian-vps:13  -f Dockerfile.debian13 .

cd /cvps
pm2 start bot.js --name vps-bot
pm2 save
pm2 startup -y
pm2 status
