#!/bin/bash
set -e

if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS_ID=$ID
    OS_CODENAME=$VERSION_CODENAME
else
    echo "❌ Cannot detect OS version. Exiting..."
    exit 1
fi

echo "💻 Detected OS: $OS_ID ($OS_CODENAME)"

echo "📦 Updating system..."
apt update -y

echo "🟢 Checking Node.js..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
else
    echo "Node.js already installed: $(node -v)"
fi

echo "⚡ Checking PM2..."
if ! command -v pm2 &> /dev/null; then
    npm install -g pm2
else
    echo "PM2 already installed: $(pm2 -v)"
fi

echo "🐳 Checking Docker..."
if ! command -v docker &> /dev/null; then
    echo "Installing Docker CE for $OS_ID..."
    apt install -y ca-certificates curl gnupg
    install -m 0755 -d /etc/apt/keyrings
    
    curl -fsSL https://download.docker.com/linux/$OS_ID/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$OS_ID $OS_CODENAME stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
    
    apt update -y
    apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    systemctl enable --now docker
else
    echo "Docker already installed: $(docker -v)"
fi

echo "📁 Preparing data folder..."
mkdir -p /data
chmod 777 /data

cd "$(dirname "$0")"

echo "📦 Installing bot dependencies..."
if [ ! -d "node_modules" ]; then
    npm install --production
fi

echo "🏗️ Building Docker images..."
cd docker

[ -z "$(docker images -q ubuntu-vps:22.04)" ] && docker build -t ubuntu-vps:22.04 -f Dockerfile.ubuntu22 .
[ -z "$(docker images -q ubuntu-vps:24.04)" ] && docker build -t ubuntu-vps:24.04 -f Dockerfile.ubuntu24 .
[ -z "$(docker images -q debian-vps:11)" ]  && docker build -t debian-vps:11  -f Dockerfile.debian11 .
[ -z "$(docker images -q debian-vps:12)" ]  && docker build -t debian-vps:12  -f Dockerfile.debian12 .
[ -z "$(docker images -q debian-vps:13)" ]  && docker build -t debian-vps:13  -f Dockerfile.debian13 .

cd ..

echo "▶️ Starting bot with PM2..."
if ! pm2 list | grep -q "vps-bot"; then
    pm2 start bot.js --name vps-bot
    pm2 save
    pm2 startup -y
else
    pm2 restart vps-bot
fi

echo "✅ Installation complete!"
pm2 status
