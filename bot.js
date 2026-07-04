const { Telegraf, Markup } = require("telegraf");
const settings = require("./settings");
const OS_OPTIONS = require("./config/os");
const fs = require("fs").promises;
const crypto = require("crypto");
const { exec } = require("child_process");
const util = require("util");
const execPromise = util.promisify(exec);
const os = require("os");

const TOKEN = settings.token;
const OWNER_ID = String(settings.owner || "");
const ADMIN_IDS = Array.from(new Set([OWNER_ID, ...(settings.admins || []).map(String)].filter(Boolean)));
const LOGS_CHANNEL = settings.logsChannel;
const VERIFY_CHANNEL = settings.verification.channel;
const FREE_VPS_DURATION = settings.durations.freeVpsMs;
const EXTEND_DURATION = settings.durations.extendMs;
const EXTEND_COST = settings.prices.extendCost;
const CREATE_VPS_COST = settings.prices.createVpsCost;
const DAILY_REWARD = settings.prices.dailyReward;
const REFERRAL_BONUS = settings.prices.referralBonus;
const REFERRAL_BONUS_INCREASE = settings.prices.referralBonusIncrease;

const PROVIDER = settings.provider;

const REGIONS = {
    singapore: { name: "Singapore", flag: "🇸🇬", code: "sg", location: "1.2897,103.8501", country: "SG", city: "Singapore", timezone: "Asia/Singapore" },
    indonesia: { name: "Indonesia (Jakarta)", flag: "🇮🇩", code: "id", location: "-6.2088,106.8456", country: "ID", city: "Jakarta", timezone: "Asia/Jakarta" },
    malaysia: { name: "Malaysia (Kuala Lumpur)", flag: "🇲🇾", code: "my", location: "3.1390,101.6869", country: "MY", city: "Kuala Lumpur", timezone: "Asia/Kuala_Lumpur" },
    thailand: { name: "Thailand (Bangkok)", flag: "🇹🇭", code: "th", location: "13.7563,100.5018", country: "TH", city: "Bangkok", timezone: "Asia/Bangkok" },
    vietnam: { name: "Vietnam (Ho Chi Minh)", flag: "🇻🇳", code: "vn", location: "10.8231,106.6297", country: "VN", city: "Ho Chi Minh", timezone: "Asia/Ho_Chi_Minh" }
};

const MODULES = {
    nodejs: { name: "Node.js", versions: ["18","20","22"], cmd: (v) => `curl -fsSL https://deb.nodesource.com/setup_${v}.x | bash - && apt install -y nodejs` },
    python: { name: "Python", versions: ["3.10","3.11","3.12"], cmd: (v) => `apt install -y python${v} python${v}-pip` },
    golang: { name: "Golang", versions: ["1.20","1.21","1.22"], cmd: (v) => `wget https://go.dev/dl/go${v}.linux-amd64.tar.gz && tar -C /usr/local -xzf go${v}.linux-amd64.tar.gz` },
    nginx: { name: "Nginx", versions: ["latest"], cmd: () => `apt install -y nginx` },
    mysql: { name: "MySQL", versions: ["8.0"], cmd: () => `apt install -y mysql-server` },
    postgresql: { name: "PostgreSQL", versions: ["15","16"], cmd: (v) => `apt install -y postgresql-${v}` },
    redis: { name: "Redis", versions: ["latest"], cmd: () => `apt install -y redis-server` },
    docker: { name: "Docker", versions: ["latest"], cmd: () => `curl -fsSL https://get.docker.com | bash` },
    php: { name: "PHP", versions: ["8.1","8.2","8.3"], cmd: (v) => `apt install -y php${v} php${v}-{cli,fpm,common,mysql,zip,gd,mbstring,curl,xml,bcmath,json}` },
    java: { name: "Java", versions: ["11","17","21"], cmd: (v) => `apt install -y openjdk-${v}-jdk` }
};

const PRICES = { IDR: settings.prices.premiumIdr };

const TIERS = {
    FREE: { name: "Free", maxRam: 2, maxCpu: 1, maxDisk: 50, maxVPS: 1, coinCost: CREATE_VPS_COST, antiDDoS: 10, emoji: "🆓", duration: FREE_VPS_DURATION },
    PREMIUM: { name: "Premium", maxRam: 5, maxCpu: 3, maxDisk: 100, maxVPS: 999, coinCost: 0, antiDDoS: 5, emoji: "💎", duration: null },
    OWNER: { name: "Owner", maxRam: 16, maxCpu: 6, maxDisk: 320, maxVPS: 9999, coinCost: 0, antiDDoS: 0, emoji: "👑", duration: null }
};

const DAILY_COOLDOWN = settings.durations.dailyCooldownMs;
const VIDEO_LINK = settings.videoLink;

class Database {
    constructor() {
        this.file = "database.json";
        this.data = { users: {}, vps: {}, referrals: {}, transactions: [], verified: [] };
        this.load();
    }
    async load() {
        try {
            const data = await fs.readFile(this.file, "utf8");
            this.data = JSON.parse(data);
        } catch { await this.save(); }
    }
    async save() {
        await fs.writeFile(this.file, JSON.stringify(this.data, null, 2));
    }
    getUser(userId) {
        const isOwner = isOwnerUser(userId);
        if (!this.data.users[userId]) {
            this.data.users[userId] = {
                tier: isOwner ? "OWNER" : "FREE",
                coins: isOwner ? 999999999 : 0,
                vps: [],
                referrals: [],
                isBlocked: false,
                premiumExpiry: null,
                referralCode: crypto.randomBytes(4).toString("hex").toUpperCase(),
                createdAt: new Date().toISOString(),
                lastDaily: null,
                totalDailyClaimed: 0,
                startedAt: null,
                lastActivity: null,
                referralCount: 0,
                verified: false,
                phoneNumber: null,
                contact: null
            };
            this.save();
        } else {
            if (isOwner && this.data.users[userId].tier !== "OWNER") {
                this.data.users[userId].tier = "OWNER";
                this.data.users[userId].coins = 999999999;
                this.save();
            }
            this.data.users[userId].lastActivity = new Date().toISOString();
            this.save();
        }
        return this.data.users[userId];
    }
    async verifyUser(userId) {
        const user = this.getUser(userId);
        user.verified = true;
        await this.save();
        return true;
    }
    async isVerified(userId) {
        const user = this.getUser(userId);
        return user.verified || isPrivilegedUser(userId);
    }
    async createVPS(userId, osKey, ram, cpu, disk, tier, region) {
        const vpsId = crypto.randomBytes(8).toString("hex");
        const user = this.getUser(userId);
        const regionData = REGIONS[region];
        const vps = {
            id: vpsId, owner: userId, os: osKey, ram, cpu, disk,
            region: region, regionName: regionData ? regionData.name : "Unknown",
            regionFlag: regionData ? regionData.flag : "🌍",
            regionLocation: regionData ? regionData.location : "0,0",
            regionCountry: regionData ? regionData.country : "XX",
            regionCity: regionData ? regionData.city : "Unknown",
            regionTimezone: regionData ? regionData.timezone : "UTC",
            provider: PROVIDER, status: "creating",
            createdAt: new Date().toISOString(),
            antiDDoS: TIERS[tier].antiDDoS,
            sshCommand: null, containerId: null, tier,
            isFree: tier === "FREE",
            expiresAt: tier === "FREE" ? new Date(Date.now() + FREE_VPS_DURATION).toISOString() : null,
            modules: []
        };
        this.data.vps[vpsId] = vps;
        user.vps.push(vpsId);
        await this.save();
        return vps;
    }
    async extendVPS(vpsId) {
        const vps = this.data.vps[vpsId];
        if (!vps || !vps.isFree) return null;
        const now = new Date(vps.expiresAt);
        now.setMinutes(now.getMinutes() + 15);
        vps.expiresAt = now.toISOString();
        await this.save();
        return vps.expiresAt;
    }
    async deleteVPS(vpsId) {
        const vps = this.data.vps[vpsId];
        if (!vps) return false;
        const user = this.getUser(vps.owner);
        user.vps = user.vps.filter(id => id !== vpsId);
        delete this.data.vps[vpsId];
        await this.save();
        return true;
    }
    async deleteAllVPS() {
        const allVps = Object.keys(this.data.vps);
        for (const vpsId of allVps) {
            const vps = this.data.vps[vpsId];
            if (vps) {
                const user = this.getUser(vps.owner);
                user.vps = user.vps.filter(id => id !== vpsId);
                if (vps.containerId) {
                    try {
                        await execPromise(`docker stop ${vps.containerId} 2>/dev/null || true`);
                        await execPromise(`docker rm ${vps.containerId} 2>/dev/null || true`);
                    } catch (e) {}
                }
                delete this.data.vps[vpsId];
            }
        }
        await this.save();
        return true;
    }
    async stopAllVPS() {
        for (const vps of Object.values(this.data.vps)) {
            if (vps.containerId) {
                try {
                    await execPromise(`docker stop ${vps.containerId} 2>/dev/null || true`);
                    vps.status = "stopped";
                } catch (e) {}
            }
        }
        await this.save();
        return true;
    }
    async addCoins(userId, amount) {
        const user = this.getUser(userId);
        user.coins += amount;
        await this.save();
        return user.coins;
    }
    async removeCoins(userId, amount) {
        const user = this.getUser(userId);
        if (user.coins < amount) return false;
        user.coins -= amount;
        await this.save();
        return true;
    }
    async useCoins(userId, amount) {
        const user = this.getUser(userId);
        if (user.coins < amount) return false;
        user.coins -= amount;
        await this.save();
        return true;
    }
    async claimDaily(userId) {
        const user = this.getUser(userId);
        const now = Date.now();
        const lastDaily = user.lastDaily || 0;
        if (now - lastDaily < DAILY_COOLDOWN) {
            const remaining = DAILY_COOLDOWN - (now - lastDaily);
            const hours = Math.floor(remaining / (60 * 60 * 1000));
            const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
            return { success: false, remaining: `${hours}h ${minutes}m` };
        }
        user.coins += DAILY_REWARD;
        user.lastDaily = now;
        user.totalDailyClaimed = (user.totalDailyClaimed || 0) + 1;
        await this.save();
        return { success: true, amount: DAILY_REWARD, total: user.coins };
    }
    async processReferral(referralCode, newUserId) {
        for (const [userId, user] of Object.entries(this.data.users)) {
            if (user.referralCode === referralCode) {
                const bonus = await this.getReferralBonus(parseInt(userId));
                await this.addCoins(parseInt(userId), bonus);
                user.referralCount = (user.referralCount || 0) + 1;
                if (!this.data.referrals[referralCode]) {
                    this.data.referrals[referralCode] = { owner: parseInt(userId), uses: [] };
                }
                this.data.referrals[referralCode].uses.push({
                    userId: newUserId,
                    timestamp: new Date().toISOString()
                });
                await this.save();
                return { referrerId: parseInt(userId), bonus: bonus };
            }
        }
        return null;
    }
    async getReferralBonus(userId) {
        const user = this.getUser(userId);
        const count = user.referralCount || 0;
        let bonus = REFERRAL_BONUS;
        bonus += Math.floor(count / 10) * REFERRAL_BONUS_INCREASE;
        return bonus;
    }
    async upgradeToPremium(userId, days = 30) {
        const user = this.getUser(userId);
        if (user.tier === "OWNER") return false;
        if (user.coins < 500) return false;
        await this.useCoins(userId, 500);
        user.tier = "PREMIUM";
        const expiry = new Date(user.premiumExpiry || Date.now());
        expiry.setDate(expiry.getDate() + days);
        user.premiumExpiry = expiry.toISOString();
        await this.save();
        return user.premiumExpiry;
    }
    async addPremiumDays(userId, days) {
        const user = this.getUser(userId);
        const expiry = new Date(user.premiumExpiry || Date.now());
        expiry.setDate(expiry.getDate() + days);
        user.premiumExpiry = expiry.toISOString();
        user.tier = "PREMIUM";
        await this.save();
        return user.premiumExpiry;
    }
    async upgradeAntiDDoS(vpsId) {
        const vps = this.data.vps[vpsId];
        if (!vps) return null;
        const currentLevel = vps.antiDDoS;
        if (currentLevel <= 0) return null;
        const upgradeAmount = Math.floor(Math.random() * 3) + 1;
        const newLevel = Math.min(currentLevel + upgradeAmount, 10);
        vps.antiDDoS = newLevel;
        await this.save();
        return newLevel;
    }
    async addModule(vpsId, moduleName, version) {
        const vps = this.data.vps[vpsId];
        if (!vps) return null;
        if (!vps.modules) vps.modules = [];
        vps.modules.push({ name: moduleName, version: version, installedAt: new Date().toISOString() });
        await this.save();
        return vps.modules;
    }
    async getAllVPS() { return Object.values(this.data.vps); }
    async getAllUsers() { return this.data.users; }
    getActiveUsers() {
        const result = [];
        for (const [id, user] of Object.entries(this.data.users)) {
            if (user.startedAt) {
                result.push({ id, ...user });
            }
        }
        return result;
    }
    getTopReferrals() {
        const users = Object.entries(this.data.users);
        users.sort((a, b) => (b[1].referralCount || 0) - (a[1].referralCount || 0));
        return users.slice(0, 10);
    }
    getSystemStats() {
        const totalRam = os.totalmem() / (1024 ** 3);
        const freeRam = os.freemem() / (1024 ** 3);
        const usedRam = totalRam - freeRam;
        const cpuLoad = os.loadavg()[0];
        const totalDisk = 320;
        const usedDisk = 50;
        return {
            cpu: Math.min(Math.round((cpuLoad / 6) * 100), 100),
            ram: Math.round((usedRam / totalRam) * 100),
            totalRam: Math.round(totalRam),
            usedRam: Math.round(usedRam),
            disk: Math.round((usedDisk / totalDisk) * 100),
            totalDisk: totalDisk,
            usedDisk: usedDisk
        };
    }
}

const db = new Database();
const bot = new Telegraf(TOKEN);

function normalizeId(id) { return String(id || ""); }
function isOwnerUser(id) { return normalizeId(id) === OWNER_ID; }
function isPrivilegedUser(id) { return ADMIN_IDS.includes(normalizeId(id)); }
function userRole(id, user) { if (isOwnerUser(id) || user?.tier === "OWNER") return "OWNER"; if (ADMIN_IDS.includes(normalizeId(id))) return "ADMIN"; return user?.tier || "FREE"; }
function html(lines) { return lines.filter(Boolean).join("\n"); }
function esc(value) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function divider() { return "<b>━━━━━━━━━━━━━━━━━━━━</b>"; }
function twoColumnButtons(items) { const rows = []; for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2)); return rows; }
async function sendPage(ctx, text, buttons = []) { const extra = { parse_mode: "HTML", ...Markup.inlineKeyboard(buttons) }; if (ctx.updateType === "callback_query") return ctx.editMessageText(text, extra).catch(() => ctx.reply(text, extra)); return ctx.reply(text, extra); }
async function getOwnerMention(ctx) { try { const chat = await ctx.telegram.getChat(OWNER_ID); if (chat.username) return `@${chat.username}`; const name = [chat.first_name, chat.last_name].filter(Boolean).join(" ") || settings.brandName; return esc(name); } catch { return esc(settings.brandName); } }
function backButton() { return [Markup.button.callback("⬅️ Kembali", "menu_home")]; }

bot.use(async (ctx, next) => {
    if (ctx.chat && ctx.chat.type === "channel") return;
    if (ctx.message && ctx.message.forward_date) return;

    const userId = ctx.from?.id;
    if (!userId) return next();

    const user = db.getUser(userId);
    const role = userRole(userId, user);
    ctx.user = user;
    ctx.userId = userId;
    ctx.isAdmin = role === "OWNER" || role === "ADMIN";
    ctx.role = role;

    if (ctx.isAdmin) return next();
    if (!settings.verification.enabled) {
        user.verified = true;
        await db.save();
        return next();
    }

    const hasContact = !settings.verification.requireContact || Boolean(user.phoneNumber);
    let hasJoined = true;

    if (settings.verification.requireChannelJoin) {
        try {
            const member = await ctx.telegram.getChatMember(VERIFY_CHANNEL, userId);
            hasJoined = ["creator", "administrator", "member"].includes(member.status);
        } catch {
            hasJoined = false;
        }
    }

    if (hasContact && hasJoined) {
        if (!user.verified) await db.verifyUser(userId);
        return next();
    }

    if (ctx.message?.contact) return next();

    const rows = [];
    if (settings.verification.requireContact && !user.phoneNumber) {
        rows.push([Markup.button.contactRequest("📱 Register Kontak")]);
    }

    const channelLine = settings.verification.requireChannelJoin
        ? `• Join channel: <b>${esc(VERIFY_CHANNEL)}</b> ${hasJoined ? "✅" : "❌"}`
        : "• Join channel: <b>Opsional</b>";

    const text = html([
        "<b>🔐 Verifikasi Akun</b>",
        divider(),
        `Brand: <b>${esc(settings.brandName)}</b>`,
        `Role: <b>${esc(role)}</b>`,
        `Kontak: <b>${hasContact ? "Terdaftar ✅" : "Belum ❌"}</b>`,
        channelLine,
        divider(),
        "Kirim kontak dengan tombol di bawah, lalu gunakan /start lagi."
    ]);

    return ctx.reply(text, {
        parse_mode: "HTML",
        reply_markup: rows.length ? { keyboard: rows, resize_keyboard: true, one_time_keyboard: true } : { remove_keyboard: true }
    });
});

bot.on("contact", async (ctx) => {
    const contact = ctx.message.contact;
    if (contact.user_id && contact.user_id !== ctx.from.id) {
        return ctx.reply("❌ Kirim kontak akun Telegram Anda sendiri.");
    }
    const user = db.getUser(ctx.from.id);
    user.phoneNumber = contact.phone_number;
    user.contact = {
        firstName: contact.first_name || null,
        lastName: contact.last_name || null,
        userId: contact.user_id || ctx.from.id,
        registeredAt: new Date().toISOString()
    };
    await db.save();
    await ctx.reply("✅ Kontak berhasil disimpan. Ketik /start untuk membuka menu.", Markup.removeKeyboard());
});

async function getTmateSSH(containerId) {
    try {
        const { stdout } = await execPromise(`docker exec ${containerId} tmate -S /tmp/tmate.sock display -p "#{tmate_ssh}" 2>/dev/null || echo ""`);
        if (stdout.trim()) return stdout.trim();
        const { stdout: msgOut } = await execPromise(`docker exec ${containerId} tmate -S /tmp/tmate.sock show-messages 2>/dev/null | grep "ssh session:" | tail -1 | cut -d" " -f3- || echo ""`);
        if (msgOut.trim()) return msgOut.trim();
        return null;
    } catch (error) {
        console.error("Error getting SSH:", error.message);
        return null;
    }
}
async function startTmateSession(containerId) {
    try {
        await execPromise(`docker exec ${containerId} tmate -S /tmp/tmate.sock new-session -d 2>/dev/null || true`);
        await execPromise(`docker exec ${containerId} tmate -S /tmp/tmate.sock wait tmate-ready 2>/dev/null || true`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        const ssh = await getTmateSSH(containerId);
        return ssh;
    } catch (error) {
        console.error("Error starting tmate:", error.message);
        return null;
    }
}

async function installModuleOnVPS(containerId, moduleKey, version) {
    try {
        const module = MODULES[moduleKey];
        if (!module) return { success: false, error: "Module tidak ditemukan" };
        await execPromise(`docker exec ${containerId} apt update -y 2>/dev/null || true`);
        const installCmd = typeof module.cmd === 'function' ? module.cmd(version) : module.cmd;
        const { stdout, stderr } = await execPromise(`docker exec ${containerId} bash -c "${installCmd}" 2>&1`);
        return { success: true, output: stdout || stderr };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function scheduleFreeVPSDeletion(vpsId) {
    const vps = db.data.vps[vpsId];
    if (!vps || !vps.isFree) return;
    const delay = new Date(vps.expiresAt).getTime() - Date.now();
    if (delay <= 0) { await deleteFreeVPS(vpsId); return; }
    setTimeout(async () => { await deleteFreeVPS(vpsId); }, delay);
}
async function deleteFreeVPS(vpsId) {
    const vps = db.data.vps[vpsId];
    if (!vps) return;
    if (vps.containerId) {
        try {
            await execPromise(`docker stop ${vps.containerId} 2>/dev/null || true`);
            await execPromise(`docker rm ${vps.containerId} 2>/dev/null || true`);
        } catch (e) {}
    }
    await db.deleteVPS(vpsId);
    for (const adminId of ADMIN_IDS) {
        try {
            await bot.telegram.sendMessage(adminId, 
                `🗑️ VPS Free expired dan dihapus otomatis\n🆔 ID: ${vps.id.slice(0,8)}\n👤 Owner: ${vps.owner}`
            );
        } catch (e) {}
    }
}

async function injectRegionToContainer(containerId, regionKey) {
    const region = REGIONS[regionKey];
    if (!region) return;
    try {
        await execPromise(`docker exec ${containerId} bash -c "
            echo '${region.flag} ${region.name}' > /etc/region
            echo '${region.location}' > /etc/region-location
            echo '${region.country}' > /etc/region-country
            echo '${region.city}' > /etc/region-city
            echo '${region.timezone}' > /etc/region-timezone
            echo 'export REGION=${regionKey}' >> /root/.bashrc
            echo 'export REGION_NAME=${region.name}' >> /root/.bashrc
            echo 'export REGION_FLAG=${region.flag}' >> /root/.bashrc
            echo 'export REGION_LOCATION=${region.location}' >> /root/.bashrc
            echo 'export REGION_COUNTRY=${region.country}' >> /root/.bashrc
            echo 'export REGION_CITY=${region.city}' >> /root/.bashrc
            echo 'export REGION_TIMEZONE=${region.timezone}' >> /root/.bashrc
            ln -sf /usr/share/zoneinfo/${region.timezone} /etc/localtime 2>/dev/null || true
            echo '#!/bin/bash
            echo \"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\"
            echo \"🌏 Region: ${region.flag} ${region.name}\"
            echo \"📍 Lokasi: ${region.location}\"
            echo \"🌍 Negara: ${region.country}\"
            echo \"🏙️ Kota: ${region.city}\"
            echo \"🕐 Timezone: ${region.timezone}\"
            echo \"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\"
            echo \"☁️ Provider: ${PROVIDER}\"
            echo \"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\"
            ' > /usr/local/bin/region-info && chmod +x /usr/local/bin/region-info
            echo '/usr/local/bin/region-info' >> /root/.bashrc
        " 2>/dev/null || true`);
    } catch (e) { console.log("Region inject error:", e.message); }
}

async function showMainMenu(ctx) {
    const userId = ctx.from.id;
    const user = db.getUser(userId);
    const role = userRole(userId, user);
    const tierInfo = TIERS[user.tier];
    const maxVPS = user.tier === "OWNER" ? "♾️" : tierInfo.maxVPS;
    const canClaim = (Date.now() - (user.lastDaily || 0)) >= DAILY_COOLDOWN;
    const isVerified = await db.isVerified(userId);
    const text = html([
        `<b>🌟 ${esc(settings.brandName)}</b>`,
        divider(),
        `<b>${esc(PROVIDER)}</b>`,
        divider(),
        `👤 Role: <b>${esc(role)}</b>`,
        `🪙 Coins: <b>${user.coins}</b>`,
        `📦 VPS: <b>${user.vps.length}/${maxVPS}</b>`,
        `🎁 Daily: <b>${canClaim ? "Ready" : "Cooldown"}</b>`,
        `👥 Referral: <b>${user.referralCount || 0}</b>`,
        `📱 Phone: <b>${user.phoneNumber ? esc(user.phoneNumber) : "Belum"}</b>`,
        `✅ Verified: <b>${isVerified ? "Ya" : "Tidak"}</b>`,
        divider(),
        "Pilih menu di bawah."
    ]);
    const items = [
        Markup.button.callback("🖥️ Create", "create_vps"),
        Markup.button.callback("📋 List", "list_vps"),
        Markup.button.callback("📊 Monitor", "monitor_vps"),
        Markup.button.callback("🎁 Daily", "daily_reward"),
        Markup.button.callback("🎯 Referral", "referral_info"),
        Markup.button.callback("🏆 Top Ref", "top_referral"),
        Markup.button.callback("💎 Premium", "premium_info"),
        Markup.button.callback("👑 Owner", "contact_owner"),
        Markup.button.callback("📚 Help", "help_info")
    ];
    if (role === "OWNER" || role === "ADMIN") items.push(Markup.button.callback("🔐 Admin", "admin_panel"));
    await sendPage(ctx, text, twoColumnButtons(items));
}

bot.command("start", async (ctx) => {
    if (ctx.chat.type === "channel") return;
    const userId = ctx.from.id;
    const user = db.getUser(userId);
    user.startedAt = user.startedAt || new Date().toISOString();
    const args = ctx.message.text.split(" ");
    if (args.length > 1 && args[1].startsWith("ref_")) {
        const code = args[1].replace("ref_", "");
        const result = await db.processReferral(code, userId);
        if (result) await ctx.reply(`✅ Referral! +${result.bonus} coin`);
    }
    await db.save();
    await showMainMenu(ctx);
});

bot.action("menu_home", async (ctx) => {
    await ctx.answerCbQuery();
    await showMainMenu(ctx);
});

bot.action('create_vps', async (ctx) => {
    await ctx.answerCbQuery();
    const osList = Object.entries(OS_OPTIONS).map(([key, os]) => `• <code>${key}</code> — ${os.emoji} ${esc(os.name)}`).join("\n");
    const regionList = Object.entries(REGIONS).map(([key, region]) => `• <code>${key}</code> — ${region.flag} ${esc(region.name)}`).join("\n");
    await sendPage(ctx, html([
        "<b>🖥️ Create VPS</b>", divider(),
        `Provider: <b>${esc(PROVIDER)}</b>`,
        `Biaya: <b>${CREATE_VPS_COST} coins</b>`,
        divider(),
        "<b>Format</b>",
        "<code>/cvps [os] [region]</code>",
        divider(),
        `<b>OS</b>\n${osList}`,
        `<b>Region</b>\n${regionList}`,
        divider(),
        "Contoh: <code>/cvps ubuntu22 singapore</code>"
    ]), [backButton()]);
});

bot.action('list_vps', async (ctx) => {
    await ctx.answerCbQuery();
    const user = db.getUser(ctx.from.id);
    if (user.vps.length === 0) {
        return sendPage(ctx, html(["<b>📭 VPS Kosong</b>", divider(), "Gunakan <code>/cvps [os] [region]</code> untuk membuat VPS."]), [backButton()]);
    }
    const lines = ["<b>📋 List VPS</b>", divider(), `Total: <b>${user.vps.length}</b>`, divider()];
    for (const vpsId of user.vps) {
        const vps = db.data.vps[vpsId];
        if (!vps) continue;
        const os = OS_OPTIONS[vps.os] || { emoji: "🖥️", name: vps.os };
        const status = vps.status === 'running' ? '🟢 Running' : '🔴 Stopped';
        const remaining = vps.expiresAt ? `${Math.max(0, Math.floor((new Date(vps.expiresAt).getTime() - Date.now()) / 60000))}m` : '♾️';
        lines.push(`${os.emoji} <code>${vps.id.slice(0,8)}</code> — <b>${status}</b>`, `RAM ${vps.ram}GB • ${remaining}`);
    }
    await sendPage(ctx, html(lines), [backButton()]);
});

bot.action('monitor_vps', async (ctx) => {
    await ctx.answerCbQuery();
    const user = db.getUser(ctx.from.id);
    const stats = db.getSystemStats();
    const tierConfig = TIERS[user.tier];
    let runningVPS = 0, totalRam = 0;
    for (const vpsId of user.vps) {
        const vps = db.data.vps[vpsId];
        if (vps) { if (vps.status === 'running') runningVPS++; totalRam += vps.ram || 0; }
    }
    await sendPage(ctx, html([
        "<b>📊 Monitor</b>", divider(),
        `🖥️ CPU: <b>${stats.cpu}%</b>`,
        `💾 RAM: <b>${stats.usedRam}GB/${stats.totalRam}GB</b>`,
        `💿 Disk: <b>${stats.usedDisk}GB/${stats.totalDisk}GB</b>`,
        divider(),
        `📦 VPS: <b>${user.vps.length}</b>`,
        `🟢 Running: <b>${runningVPS}</b>`,
        `💾 Allocated: <b>${totalRam}GB</b>`,
        `🛡️ AntiDDoS: <b>Level ${tierConfig.antiDDoS}</b>`
    ]), [backButton()]);
});

bot.action('daily_reward', async (ctx) => {
    await ctx.answerCbQuery();
    const result = await db.claimDaily(ctx.from.id);
    await sendPage(ctx, result.success
        ? html(["<b>🎁 Daily Reward</b>", divider(), `Berhasil klaim <b>${result.amount}</b> coins.`, `Saldo: <b>${result.total}</b>`, "Kembali lagi dalam 24 jam."])
        : html(["<b>⏳ Daily Cooldown</b>", divider(), `Sisa waktu: <b>${result.remaining}</b>`]), [backButton()]);
});

bot.action('referral_info', async (ctx) => {
    await ctx.answerCbQuery();
    const user = db.getUser(ctx.from.id);
    const referralLink = `https://t.me/${ctx.botInfo.username}?start=ref_${user.referralCode}`;
    const refCount = db.data.referrals[user.referralCode]?.uses?.length || 0;
    const nextBonus = Math.floor(refCount / 10) * REFERRAL_BONUS_INCREASE + REFERRAL_BONUS;
    await sendPage(ctx, html(["<b>🎯 Referral</b>", divider(), `Link: <code>${esc(referralLink)}</code>`, divider(), `Total: <b>${refCount}</b>`, `Bonus: <b>${nextBonus} coins/ref</b>`, `Naik +${REFERRAL_BONUS_INCREASE} setelah ${10 - (refCount % 10)} referral lagi.`]), [backButton()]);
});

bot.action('top_referral', async (ctx) => {
    await ctx.answerCbQuery();
    const topUsers = db.getTopReferrals();
    const lines = ["<b>🏆 Top Referral</b>", divider()];
    if (topUsers.length === 0) lines.push("Belum ada data.");
    const medals = ["🥇", "🥈", "🥉"];
    topUsers.slice(0, 10).forEach(([userId, user], i) => lines.push(`${i < 3 ? medals[i] : `${i + 1}.`} <b>${esc(user.tier)}</b> <code>${userId}</code> — ${user.referralCount || 0} ref`));
    await sendPage(ctx, html(lines), [backButton()]);
});

bot.action('premium_info', async (ctx) => {
    await ctx.answerCbQuery();
    const user = db.getUser(ctx.from.id);
    const lines = ["<b>💎 Premium</b>", divider()];
    if (user.tier === "OWNER" || user.tier === "PREMIUM") {
        lines.push(`Status: <b>${esc(user.tier)}</b>`);
        if (user.premiumExpiry) lines.push(`Expired: <b>${new Date(user.premiumExpiry).toLocaleDateString()}</b>`);
    } else {
        lines.push(`Max VPS: <b>Unlimited</b>`, `RAM: <b>${TIERS.PREMIUM.maxRam}GB</b>`, `CPU: <b>${TIERS.PREMIUM.maxCpu} Core</b>`, `Disk: <b>${TIERS.PREMIUM.maxDisk}GB</b>`, `AntiDDoS: <b>Level ${TIERS.PREMIUM.antiDDoS}</b>`, divider(), `Harga: <b>Rp${PRICES.IDR}</b>`, "Kirim bukti dengan <code>/msg bukti</code>.");
    }
    await sendPage(ctx, html(lines), [backButton()]);
});

bot.action('contact_owner', async (ctx) => {
    await ctx.answerCbQuery();
    const owner = await getOwnerMention(ctx);
    await sendPage(ctx, html(["<b>👑 Contact Owner</b>", divider(), `Owner: <b>${owner}</b>`, "Kirim pesan dengan format:", "<code>/msg pesan Anda</code>"]), [backButton()]);
});

bot.action('help_info', async (ctx) => {
    await ctx.answerCbQuery();
    const isAdmin = isPrivilegedUser(ctx.from.id);
    const lines = ["<b>📚 Help</b>", divider(), "<b>VPS</b>", "<code>/cvps [os] [region]</code>", "<code>/list</code> • <code>/monitor</code>", "<code>/delete [id]</code> • <code>/regen_ssh [id]</code>", divider(), "<b>Reward</b>", "<code>/daily</code> • <code>/referral</code> • <code>/topreferral</code>", divider(), "<b>Support</b>", "<code>/premium</code> • <code>/buy_premium</code> • <code>/msg [pesan]</code>"];
    if (isAdmin) lines.push(divider(), "<b>Admin</b>", "<code>/admin</code> • <code>/stats</code> • <code>/users</code>", "<code>/addcoins</code> • <code>/addpremium</code> • <code>/broadcast</code>");
    await sendPage(ctx, html(lines), [backButton()]);
});

bot.action('admin_panel', async (ctx) => {
    await ctx.answerCbQuery();
    if (!isPrivilegedUser(ctx.from.id)) return sendPage(ctx, "⛔ Owner only!", [backButton()]);
    const users = await db.getAllUsers();
    const vpsList = await db.getAllVPS();
    const totalCoins = Object.values(users).reduce((sum, u) => sum + (u.coins || 0), 0);
    const premiumUsers = Object.values(users).filter(u => u.tier === "PREMIUM").length;
    const ownerUsers = Object.values(users).filter(u => u.tier === "OWNER").length;
    const blockedUsers = Object.values(users).filter(u => u.isBlocked).length;
    const stats = db.getSystemStats();
    await sendPage(ctx, html(["<b>🔐 Admin Panel</b>", divider(), `Users: <b>${Object.keys(users).length}</b>`, `Owner: <b>${ownerUsers}</b> • Premium: <b>${premiumUsers}</b>`, `Blocked: <b>${blockedUsers}</b>`, `VPS: <b>${vpsList.length}</b>`, `Coins: <b>${totalCoins}</b>`, divider(), `CPU: <b>${stats.cpu}%</b>`, `RAM: <b>${stats.usedRam}GB</b>`, `Disk: <b>${stats.usedDisk}GB</b>`]), [backButton()]);
});

bot.command("cvps", async (ctx) => {
    if (ctx.chat.type === 'channel') return;
    const args = ctx.message.text.split(" ");
    
    if (args.length < 3) {
        let osList = "";
        for (const [key, os] of Object.entries(OS_OPTIONS)) {
            osList += `${key} - ${os.emoji} ${os.name}\n`;
        }
        let regionList = "";
        for (const [key, region] of Object.entries(REGIONS)) {
            regionList += `${key} - ${region.flag} ${region.name}\n`;
        }
        
        return ctx.reply(
            `🖥️ CREATE VPS\n━━━━━━━━━━━━━━━━━━━━\n` +
            `${PROVIDER}\n💰 ${CREATE_VPS_COST} coins\n\n` +
            `📋 /cvps [os] [region]\n\n` +
            `🖥️ OS:\n${osList}\n` +
            `🌏 Region:\n${regionList}\n` +
            `💡 /cvps ubuntu22 singapore`
        );
    }
    
    const osKey = args[1].toLowerCase();
    const regionKey = args[2].toLowerCase();
    const userId = ctx.from.id;
    const user = db.getUser(userId);
    const tier = user.tier;
    const tierConfig = TIERS[tier];
    
    if (!OS_OPTIONS[osKey]) {
        return ctx.reply(`❌ OS "${osKey}" tidak tersedia!\n📋 OS: ubuntu22, ubuntu24, debian11, debian12, debian13`);
    }
    
    if (!REGIONS[regionKey]) {
        return ctx.reply(`❌ Region "${regionKey}" tidak tersedia!\n📋 Region: singapore, indonesia, malaysia, thailand, vietnam`);
    }
    
    const maxVPS = tier === "OWNER" ? 9999 : tierConfig.maxVPS;
    
    if (tier !== "OWNER" && user.vps.length >= maxVPS) {
        return ctx.reply(`❌ LIMIT VPS!\n📦 ${maxVPS}\n💎 Upgrade ke Premium!`);
    }
    
    if (tier === "FREE" && user.coins < tierConfig.coinCost) {
        return ctx.reply(
            `❌ COINS!\n💰 Butuh ${tierConfig.coinCost}\n🪙 Punya ${user.coins}\n` +
            `🎁 /daily atau /referral`
        );
    }
    
    const os = OS_OPTIONS[osKey];
    const region = REGIONS[regionKey];
    const ram = tierConfig.maxRam;
    const cpu = tierConfig.maxCpu;
    const disk = tierConfig.maxDisk;
    
    const vps = await db.createVPS(userId, osKey, ram, cpu, disk, tier, regionKey);
    
    if (tier === "FREE") {
        await db.useCoins(userId, tierConfig.coinCost);
    }
    
    try {
        const cmd = `docker run -d --name vps_${vps.id} --privileged ${os.image}`;
        const { stdout } = await execPromise(cmd);
        vps.containerId = stdout.trim();
        vps.status = "running";
        await db.save();
        
        await injectRegionToContainer(vps.containerId, regionKey);
        
        for (const adminId of ADMIN_IDS) {
            try {
                await bot.telegram.sendMessage(adminId,
                    `🆕 VPS Baru\n👤 ${userId}\n🌏 ${region.flag} ${region.name}\n` +
                    `🖥️ ${os.emoji} ${os.name}\n🆔 ${vps.id.slice(0,8)}\n💾 ${vps.ram}GB\n📊 ${tier}`
                );
            } catch (e) {}
        }
        
        await ctx.reply(
            `⏳ BUILDING...\n━━━━━━━━━━━━━━━━━━━━\n` +
            `🌏 ${region.flag} ${region.name}\n📍 ${region.location}\n` +
            `☁️ ${PROVIDER}\n🖥️ ${os.emoji} ${os.name}\n` +
            `🆔 ${vps.id.slice(0,8)}\n💾 ${vps.ram}GB\n⚡ ${vps.cpu} Core\n💿 ${vps.disk}GB\n` +
            `🛡️ Level ${vps.antiDDoS}\n━━━━━━━━━━━━━━━━━━━━\n⏳ SSH...`
        );
        
        await new Promise(resolve => setTimeout(resolve, 5000));
        const sshCommand = await startTmateSession(vps.containerId);
        
        if (sshCommand) {
            vps.sshCommand = sshCommand;
            await db.save();
            
            for (const adminId of ADMIN_IDS) {
                try {
                    await bot.telegram.sendMessage(adminId, `🔑 SSH ${vps.id.slice(0,8)}\n${sshCommand}`);
                } catch (e) {}
            }
            
            const remaining = vps.expiresAt ? Math.max(0, Math.floor((new Date(vps.expiresAt).getTime() - Date.now()) / 60000)) : '♾️';
            
            await ctx.reply(
                `✅ VPS READY!\n━━━━━━━━━━━━━━━━━━━━\n` +
                `🌏 ${region.flag} ${region.name}\n📍 ${region.location}\n` +
                `🖥️ ${os.emoji} ${os.name}\n🆔 ${vps.id.slice(0,8)}\n` +
                `💾 ${vps.ram}GB\n⚡ ${vps.cpu} Core\n💿 ${vps.disk}GB\n` +
                `🛡️ Level ${vps.antiDDoS}\n📊 ${tier}\n` +
                `⏳ ${remaining !== '♾️' ? remaining+'m' : '♾️'}\n━━━━━━━━━━━━━━━━━━━━\n` +
                `🔑 SSH\n${sshCommand}\n━━━━━━━━━━━━━━━━━━━━\n` +
                `📦 /module [id] [module]\n⏰ /extend [id] (${EXTEND_COST} coins)\n` +
                `⚠️ NO DDOS! BAN PERMANEN!`
            );
        } else {
            await ctx.reply(`⚠️ VPS ${vps.id.slice(0,8)} dibuat\n🔑 SSH belum siap\n💡 /regen_ssh ${vps.id.slice(0,8)}`);
        }
    } catch (error) {
        console.error("Deploy error:", error);
        await ctx.reply(`❌ Gagal deploy VPS: ${error.message}`);
    }
});

bot.command("list", async (ctx) => {
    if (ctx.chat.type === 'channel') return;
    const userId = ctx.from.id;
    const user = db.getUser(userId);
    
    if (user.vps.length === 0) {
        return ctx.reply(`📭 TIDAK ADA VPS\n💡 /cvps [os] [region]`);
    }
    
    let msg = `📋 VPS\n━━━━━━━━━━━━━━━━━━━━\n📊 ${user.vps.length}\n\n`;
    for (const vpsId of user.vps) {
        const vps = db.data.vps[vpsId];
        if (!vps) continue;
        const os = OS_OPTIONS[vps.os];
        const status = vps.status === 'running' ? '🟢' : '🔴';
        const remaining = vps.expiresAt ? Math.max(0, Math.floor((new Date(vps.expiresAt).getTime() - Date.now()) / 60000)) : '♾️';
        msg += `${os.emoji} ${vps.id.slice(0,8)} ${status} ${vps.ram}GB\n`;
    }
    await ctx.reply(msg);
});

bot.command("monitor", async (ctx) => {
    if (ctx.chat.type === 'channel') return;
    const userId = ctx.from.id;
    const user = db.getUser(userId);
    const stats = db.getSystemStats();
    const tierConfig = TIERS[user.tier];
    
    let runningVPS = 0, totalRam = 0;
    for (const vpsId of user.vps) {
        const vps = db.data.vps[vpsId];
        if (vps) {
            if (vps.status === 'running') runningVPS++;
            totalRam += vps.ram || 0;
        }
    }
    const maxVPS = user.tier === "OWNER" ? "♾️" : tierConfig.maxVPS;
    
    await ctx.reply(
        `📊 MONITOR\n━━━━━━━━━━━━━━━━━━━━\n` +
        `🖥️ CPU ${stats.cpu}%\n` +
        `💾 RAM ${stats.usedRam}GB/${stats.totalRam}GB (${stats.ram}%)\n` +
        `💿 Disk ${stats.usedDisk}GB/${stats.totalDisk}GB (${stats.disk}%)\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📦 ${user.vps.length} VPS\n` +
        `🟢 ${runningVPS} Running\n` +
        `💾 ${totalRam}GB RAM\n` +
        `📊 ${user.tier}\n` +
        `🪙 ${user.coins}\n` +
        `📦 Max ${maxVPS}\n` +
        `🛡️ Level ${tierConfig.antiDDoS}`
    );
});

bot.command("delete", async (ctx) => {
    if (ctx.chat.type === 'channel') return;
    const args = ctx.message.text.split(" ");
    if (args.length < 2) {
        return ctx.reply(`❌ /delete [vps_id]\n💡 /delete c14c7da6`);
    }
    const vpsId = args[1];
    const userId = ctx.from.id;
    
    let foundVps = null, foundKey = null;
    for (const [key, vps] of Object.entries(db.data.vps)) {
        if (vps.id.startsWith(vpsId) && vps.owner === userId) {
            foundVps = vps;
            foundKey = key;
            break;
        }
    }
    if (!foundVps) return ctx.reply(`❌ VPS tidak ditemukan!`);
    
    if (foundVps.containerId) {
        try {
            await execPromise(`docker stop ${foundVps.containerId} 2>/dev/null || true`);
            await execPromise(`docker rm ${foundVps.containerId} 2>/dev/null || true`);
        } catch (e) {}
    }
    await db.deleteVPS(foundKey);
    await ctx.reply(`✅ VPS ${foundVps.id.slice(0,8)} dihapus!`);
});

bot.command("regen_ssh", async (ctx) => {
    if (ctx.chat.type === 'channel') return;
    const args = ctx.message.text.split(" ");
    if (args.length < 2) {
        return ctx.reply(`❌ /regen_ssh [vps_id]\n💡 /regen_ssh c14c7da6`);
    }
    const vpsId = args[1];
    const userId = ctx.from.id;
    
    let foundVps = null, foundKey = null;
    for (const [key, vps] of Object.entries(db.data.vps)) {
        if (vps.id.startsWith(vpsId) && vps.owner === userId) {
            foundVps = vps;
            foundKey = key;
            break;
        }
    }
    if (!foundVps) return ctx.reply(`❌ VPS tidak ditemukan!`);
    if (!foundVps.containerId) return ctx.reply(`❌ Container tidak ditemukan!`);
    
    await ctx.reply(`🔄 SSH ${foundVps.id.slice(0,8)}...`);
    try {
        await execPromise(`docker exec ${foundVps.containerId} pkill tmate 2>/dev/null || true`);
        await execPromise(`docker exec ${foundVps.containerId} rm -f /tmp/tmate.sock 2>/dev/null || true`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        const sshCommand = await startTmateSession(foundVps.containerId);
        if (sshCommand) {
            foundVps.sshCommand = sshCommand;
            await db.save();
            await ctx.reply(`✅ SSH REGENERASI!\n🔑 ${sshCommand}`);
        } else {
            await ctx.reply(`❌ Gagal. Coba lagi nanti.`);
        }
    } catch (error) {
        await ctx.reply(`❌ Gagal: ${error.message}`);
    }
});

bot.command("extend", async (ctx) => {
    if (ctx.chat.type === 'channel') return;
    const args = ctx.message.text.split(" ");
    if (args.length < 2) {
        return ctx.reply(
            `⏰ EXTEND\n━━━━━━━━━━━━━━━━━━━━\n` +
            `💰 ${EXTEND_COST} coins\n⏰ +15 Menit\n\n` +
            `/extend [vps_id]\n💡 /extend c14c7da6`
        );
    }
    
    const vpsId = args[1];
    const userId = ctx.from.id;
    const user = db.getUser(userId);
    
    let foundVps = null;
    let foundKey = null;
    for (const [key, vps] of Object.entries(db.data.vps)) {
        if (vps.id.startsWith(vpsId) && vps.owner === userId) {
            foundVps = vps;
            foundKey = key;
            break;
        }
    }
    
    if (!foundVps) {
        return ctx.reply(`❌ VPS tidak ditemukan!`);
    }
    if (!foundVps.isFree) {
        return ctx.reply(`❌ Bukan Free VPS!`);
    }
    if (user.coins < EXTEND_COST) {
        return ctx.reply(
            `❌ COINS!\n💰 Butuh ${EXTEND_COST}\n🪙 Punya ${user.coins}\n` +
            `🎁 /daily (${DAILY_REWARD}) atau /referral`
        );
    }
    
    await db.useCoins(userId, EXTEND_COST);
    const newExpiry = await db.extendVPS(foundKey);
    const remaining = Math.max(0, Math.floor((new Date(newExpiry).getTime() - Date.now()) / 60000));
    
    await ctx.reply(
        `✅ EXTEND!\n━━━━━━━━━━━━━━━━━━━━\n` +
        `🆔 ${foundVps.id.slice(0,8)}\n⏰ +15 Menit\n📅 ${remaining}m tersisa\n` +
        `🪙 ${user.coins - EXTEND_COST} coins`
    );
});

bot.command("module", async (ctx) => {
    if (ctx.chat.type === 'channel') return;
    const args = ctx.message.text.split(" ");
    if (args.length < 3) {
        let moduleList = "";
        for (const [key, mod] of Object.entries(MODULES)) {
            moduleList += `${key} - ${mod.name}\n`;
        }
        return ctx.reply(
            `📦 MODULE\n━━━━━━━━━━━━━━━━━━━━\n` +
            `/module [vps_id] [module]\n\n` +
            `📦 ${moduleList}\n💡 /module c14c7da6 nodejs`
        );
    }
    
    const vpsId = args[1];
    const moduleKey = args[2].toLowerCase();
    const userId = ctx.from.id;
    
    if (!MODULES[moduleKey]) {
        return ctx.reply(`❌ Module "${moduleKey}" tidak ditemukan!`);
    }
    
    let foundVps = null;
    let foundKey = null;
    for (const [key, vps] of Object.entries(db.data.vps)) {
        if (vps.id.startsWith(vpsId) && vps.owner === userId) {
            foundVps = vps;
            foundKey = key;
            break;
        }
    }
    
    if (!foundVps) {
        return ctx.reply(`❌ VPS tidak ditemukan!`);
    }
    if (!foundVps.containerId || foundVps.status !== 'running') {
        return ctx.reply(`❌ VPS tidak running!`);
    }
    
    const module = MODULES[moduleKey];
    const version = module.versions[module.versions.length - 1];
    
    await ctx.reply(
        `⏳ Install ${module.name} v${version} di ${foundVps.id.slice(0,8)}...\n` +
        `⏳ Mungkin memakan waktu...`
    );
    
    try {
        const result = await installModuleOnVPS(foundVps.containerId, moduleKey, version);
        if (result.success) {
            await db.addModule(foundKey, moduleKey, version);
            await ctx.reply(
                `✅ ${module.name} v${version} INSTALLED!\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `🆔 ${foundVps.id.slice(0,8)}\n📦 ${module.name} v${version}\n` +
                `🔑 SSH: ${foundVps.sshCommand || 'Gunakan /regen_ssh'}`
            );
        } else {
            await ctx.reply(`❌ Gagal install: ${result.error || 'Unknown error'}`);
        }
    } catch (error) {
        await ctx.reply(`❌ Gagal install module: ${error.message}`);
    }
});

bot.command("region", async (ctx) => {
    if (ctx.chat.type === 'channel') return;
    const args = ctx.message.text.split(" ");
    if (args.length < 2) {
        return ctx.reply(`🌏 /region [vps_id]\n💡 /region c14c7da6`);
    }
    const vpsId = args[1];
    const userId = ctx.from.id;
    
    let foundVps = null;
    for (const [key, vps] of Object.entries(db.data.vps)) {
        if (vps.id.startsWith(vpsId) && vps.owner === userId) {
            foundVps = vps;
            break;
        }
    }
    if (!foundVps) return ctx.reply(`❌ VPS tidak ditemukan!`);
    
    await ctx.reply(
        `🌏 REGION\n━━━━━━━━━━━━━━━━━━━━\n` +
        `🆔 ${foundVps.id.slice(0,8)}\n` +
        `🌏 ${foundVps.regionFlag || '🌍'} ${foundVps.regionName || 'Unknown'}\n` +
        `📍 ${foundVps.regionLocation || '-'}\n` +
        `🌍 ${foundVps.regionCountry || '-'}\n` +
        `🏙️ ${foundVps.regionCity || '-'}\n` +
        `🕐 ${foundVps.regionTimezone || 'UTC'}`
    );
});

bot.command("daily", async (ctx) => {
    if (ctx.chat.type === 'channel') return;
    const result = await db.claimDaily(ctx.from.id);
    if (result.success) {
        await ctx.reply(`🎁 +${result.amount} COINS\n🪙 ${result.total}\n⏰ 24 jam lagi`);
    } else {
        await ctx.reply(`⏳ ${result.remaining}\n💡 Kembali lagi nanti!`);
    }
});

bot.command("referral", async (ctx) => {
    if (ctx.chat.type === 'channel') return;
    const userId = ctx.from.id;
    const user = db.getUser(userId);
    const botUsername = ctx.botInfo.username;
    const referralLink = `https://t.me/${botUsername}?start=ref_${user.referralCode}`;
    const refCount = db.data.referrals[user.referralCode]?.uses?.length || 0;
    const nextBonus = Math.floor(refCount / 10) * REFERRAL_BONUS_INCREASE + REFERRAL_BONUS;
    
    await ctx.reply(
        `🎯 REFERRAL\n━━━━━━━━━━━━━━━━━━━━\n` +
        `🔗 ${referralLink}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `👥 ${refCount}\n🎁 ${nextBonus} coins/ref\n` +
        `📈 +${REFERRAL_BONUS_INCREASE} (${10-(refCount%10)} lagi)`
    );
});

bot.command("topreferral", async (ctx) => {
    if (ctx.chat.type === 'channel') return;
    const topUsers = db.getTopReferrals();
    if (topUsers.length === 0) {
        return ctx.reply(`🏆 TOP REFERRAL\n━━━━━━━━━━━━━━━━━━━━\nBelum ada data.`);
    }
    let msg = `🏆 TOP 10\n━━━━━━━━━━━━━━━━━━━━\n`;
    const medals = ["🥇", "🥈", "🥉"];
    for (let i = 0; i < Math.min(topUsers.length, 10); i++) {
        const [userId, user] = topUsers[i];
        const medal = i < 3 ? medals[i] : `${i+1}.`;
        const emoji = user.tier === "OWNER" ? "👑" : user.tier === "PREMIUM" ? "💎" : "🆓";
        msg += `${medal} ${emoji} ${userId}\n   ${user.referralCount||0} ref\n`;
    }
    await ctx.reply(msg);
});

bot.command("premium", async (ctx) => {
    if (ctx.chat.type === 'channel') return;
    const user = db.getUser(ctx.from.id);
    if (user.tier === "OWNER") {
        return ctx.reply(`✅ OWNER\n👑 Tier: Owner\n🛡️ Level ${TIERS.OWNER.antiDDoS}\n💾 ${TIERS.OWNER.maxRam}GB`);
    }
    if (user.tier === "PREMIUM") {
        const expiry = user.premiumExpiry ? new Date(user.premiumExpiry) : null;
        return ctx.reply(`✅ PREMIUM\n📅 ${expiry ? expiry.toLocaleDateString() : 'Permanen'}\n🛡️ Level ${TIERS.PREMIUM.antiDDoS}\n💾 ${TIERS.PREMIUM.maxRam}GB`);
    }
    await ctx.reply(
        `💎 PREMIUM\n━━━━━━━━━━━━━━━━━━━━\n` +
        `📦 Unlimited VPS\n💾 ${TIERS.PREMIUM.maxRam}GB\n⚡ ${TIERS.PREMIUM.maxCpu} Core\n💿 ${TIERS.PREMIUM.maxDisk}GB\n🛡️ Level ${TIERS.PREMIUM.antiDDoS}\n━━━━━━━━━━━━━━━━━━━━\n` +
        `💰 Rp${PRICES.IDR}\n📱 DANA | GOPAY | QRIS\n━━━━━━━━━━━━━━━━━━━━\n` +
        `📋 Transfer Rp${PRICES.IDR}\n📋 Screenshot\n📋 /msg bukti`
    );
});

bot.command("buy_premium", async (ctx) => {
    if (ctx.chat.type === 'channel') return;
    const user = db.getUser(ctx.from.id);
    if (user.tier === "OWNER" || user.tier === "PREMIUM") {
        return ctx.reply(`✅ Anda sudah ${user.tier}!`);
    }
    const owner = await getOwnerMention(ctx);
    await ctx.reply(
        html([
            "<b>💎 Beli Premium</b>",
            divider(),
            `Harga: <b>Rp${PRICES.IDR}</b>`,
            "Payment: <b>DANA | GOPAY | QRIS</b>",
            divider(),
            `Owner: <b>${owner}</b>`,
            `Transfer Rp${PRICES.IDR}, screenshot, lalu kirim <code>/msg bukti</code>.`
        ]),
        { parse_mode: "HTML" }
    );
});

bot.command("msg", async (ctx) => {
    if (ctx.chat.type === 'channel') return;
    const text = ctx.message.text.replace("/msg", "").trim();
    if (!text) {
        return ctx.reply(`❌ /msg [pesan]\n💡 /msg Saya mau tanya`);
    }
    for (const adminId of ADMIN_IDS) {
        try {
            await bot.telegram.sendMessage(adminId, 
                `📩 PESAN\n👤 ${ctx.from.id}\n💬 ${text}`
            );
        } catch (e) {}
    }
    await ctx.reply(`✅ Pesan terkirim ke owner!`);
});

bot.command("qemu", async (ctx) => {
    if (ctx.chat.type === 'channel') return;
    await ctx.reply(
        `🖥️ QEMU\n━━━━━━━━━━━━━━━━━━━━\n` +
        `📋 Perintah:\n` +
        `apt install qemu-system cloud-image-utils wget -y\n` +
        `bash <(curl -fsSL https://raw.githubusercontent.com/hopingboyz/vms/main/nokvm.sh)\n` +
        `━━━━━━━━━━━━━━━━━━━━\n📹 /qemu_video`
    );
});

bot.command("qemu_video", async (ctx) => {
    if (ctx.chat.type === 'channel') return;
    await ctx.reply(
        `📹 QEMU\n━━━━━━━━━━━━━━━━━━━━\n` +
        `🔗 ${VIDEO_LINK}\n━━━━━━━━━━━━━━━━━━━━\n` +
        `📋 Perintah:\n` +
        `apt install qemu-system cloud-image-utils wget -y\n` +
        `bash <(curl -fsSL https://raw.githubusercontent.com/hopingboyz/vms/main/nokvm.sh)`
    );
});

bot.command("admin", async (ctx) => {
    if (ctx.chat.type === 'channel') return;
    if (!isPrivilegedUser(ctx.from.id)) return ctx.reply("⛔ Owner only!");
    
    const users = await db.getAllUsers();
    const vpsList = await db.getAllVPS();
    const totalCoins = Object.values(users).reduce((sum, u) => sum + (u.coins || 0), 0);
    const premiumUsers = Object.values(users).filter(u => u.tier === "PREMIUM").length;
    const ownerUsers = Object.values(users).filter(u => u.tier === "OWNER").length;
    const blockedUsers = Object.values(users).filter(u => u.isBlocked).length;
    const stats = db.getSystemStats();
    const activeUsers = db.getActiveUsers().length;
    const verifiedUsers = Object.values(users).filter(u => u.verified === true).length;
    
    await ctx.reply(
        `🔐 ADMIN\n━━━━━━━━━━━━━━━━━━━━\n` +
        `${PROVIDER}\n━━━━━━━━━━━━━━━━━━━━\n` +
        `👥 ${Object.keys(users).length} Users (${activeUsers} aktif)\n` +
        `✅ ${verifiedUsers} Verified\n` +
        `👑 ${ownerUsers}\n💎 ${premiumUsers}\n🚫 ${blockedUsers}\n` +
        `🖥️ ${vpsList.length} VPS\n🪙 ${totalCoins} Coins\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🖥️ CPU ${stats.cpu}%\n💾 RAM ${stats.usedRam}GB\n💿 Disk ${stats.usedDisk}GB\n` +
        `━━━━━━━━━━━━━━━━━━━━\n📋 /help - Admin commands`
    );
});

bot.command("list_users", async (ctx) => {
    if (ctx.chat.type === 'channel') return;
    if (!isPrivilegedUser(ctx.from.id)) return ctx.reply("⛔ Owner only!");
    
    const activeUsers = db.getActiveUsers();
    if (activeUsers.length === 0) return ctx.reply("📭 Belum ada user.");
    
    let msg = `👥 USER\n━━━━━━━━━━━━━━━━━━━━\n`;
    for (const u of activeUsers) {
        const emoji = u.tier === "OWNER" ? "👑" : u.tier === "PREMIUM" ? "💎" : "🆓";
        msg += `${emoji} ${u.id}\n├ ${u.tier}\n├ 🪙 ${u.coins}\n├ 📦 ${u.vps?.length||0}\n├ ✅ ${u.verified?'✓':'✗'}\n└ ${u.isBlocked?'🚫':'✓'}\n\n`;
    }
    await ctx.reply(msg);
});

bot.command("user_info", async (ctx) => {
    if (ctx.chat.type === 'channel') return;
    if (!isPrivilegedUser(ctx.from.id)) return ctx.reply("⛔ Owner only!");
    
    const args = ctx.message.text.split(" ");
    if (args.length < 2) return ctx.reply(`❌ /user_info [user_id]`);
    const userId = parseInt(args[1]);
    if (isNaN(userId)) return ctx.reply(`❌ Invalid ID!`);
    
    const user = db.getUser(userId);
    const vpsList = user.vps.map(id => db.data.vps[id]).filter(v => v);
    
    let msg = `👤 USER ${userId}\n━━━━━━━━━━━━━━━━━━━━\n├ Tier: ${user.tier}\n├ 🪙 ${user.coins}\n├ 📦 ${user.vps.length}\n├ ✅ ${user.verified?'✓':'✗'}\n├ 🚫 ${user.isBlocked?'Ya':'Tidak'}\n├ 📅 ${user.totalDailyClaimed||0}x\n├ 👥 ${user.referralCount||0}\n├ Start: ${user.startedAt ? new Date(user.startedAt).toLocaleString() : 'N/A'}\n└ Last: ${user.lastActivity ? new Date(user.lastActivity).toLocaleString() : 'N/A'}\n`;
    
    if (vpsList.length > 0) {
        msg += `━━━━━━━━━━━━━━━━━━━━\n🖥️ VPS:\n`;
        for (const vps of vpsList) {
            const os = OS_OPTIONS[vps.os];
            msg += `├ ${os.emoji} ${vps.id.slice(0,8)} - ${vps.status}\n│ ${vps.regionFlag||'🌍'} ${vps.regionName||'Unknown'} | ${vps.ram}GB\n`;
        }
    }
    await ctx.reply(msg);
});

bot.command("delete_all_vps", async (ctx) => {
    if (ctx.chat.type === 'channel') return;
    if (!isPrivilegedUser(ctx.from.id)) return ctx.reply("⛔ Owner only!");
    await ctx.reply(`⚠️ PERINGATAN! Hapus SEMUA VPS.\n/confirm_delete_all dalam 30 detik.`);
});

bot.command("confirm_delete_all", async (ctx) => {
    if (ctx.chat.type === 'channel') return;
    if (!isPrivilegedUser(ctx.from.id)) return ctx.reply("⛔ Owner only!");
    await db.deleteAllVPS();
    await ctx.reply(`✅ SEMUA VPS dihapus!`);
});

bot.command("stop_all_vps", async (ctx) => {
    if (ctx.chat.type === 'channel') return;
    if (!isPrivilegedUser(ctx.from.id)) return ctx.reply("⛔ Owner only!");
    await db.stopAllVPS();
    await ctx.reply(`✅ SEMUA VPS di-stop!`);
});

bot.command("broadcast", async (ctx) => {
    if (ctx.chat.type === 'channel') return;
    if (!isPrivilegedUser(ctx.from.id)) return ctx.reply("⛔ Owner only!");
    const text = ctx.message.text.replace("/broadcast", "").trim();
    if (!text) return ctx.reply(`❌ /broadcast [pesan]`);
    
    const users = await db.getAllUsers();
    let sent = 0, failed = 0;
    for (const userId of Object.keys(users)) {
        try {
            await bot.telegram.sendMessage(parseInt(userId), `📢 ${text}`);
            sent++;
        } catch (e) { failed++; }
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    await ctx.reply(`✅ Broadcast selesai!\n📤 ${sent}\n❌ ${failed}`);
});

bot.command("addcoins", async (ctx) => {
    if (ctx.chat.type === 'channel') return;
    if (!isPrivilegedUser(ctx.from.id)) return ctx.reply("⛔ Owner only!");
    const args = ctx.message.text.split(" ");
    if (args.length < 3) return ctx.reply(`❌ /addcoins [user_id] [amount]`);
    const userId = parseInt(args[1]), amount = parseInt(args[2]);
    if (isNaN(userId) || isNaN(amount)) return ctx.reply(`❌ Invalid!`);
    const newCoins = await db.addCoins(userId, amount);
    await ctx.reply(`✅ COINS ADDED!\n👤 ${userId}\n➕ +${amount}\n🪙 ${newCoins}`);
});

bot.command("removecoins", async (ctx) => {
    if (ctx.chat.type === 'channel') return;
    if (!isPrivilegedUser(ctx.from.id)) return ctx.reply("⛔ Owner only!");
    const args = ctx.message.text.split(" ");
    if (args.length < 3) return ctx.reply(`❌ /removecoins [user_id] [amount]`);
    const userId = parseInt(args[1]), amount = parseInt(args[2]);
    if (isNaN(userId) || isNaN(amount)) return ctx.reply(`❌ Invalid!`);
    const success = await db.removeCoins(userId, amount);
    if (!success) return ctx.reply(`❌ Coins tidak cukup!`);
    const user = db.getUser(userId);
    await ctx.reply(`✅ COINS REMOVED!\n👤 ${userId}\n➖ -${amount}\n🪙 ${user.coins}`);
});

bot.command("checkcoins", async (ctx) => {
    if (ctx.chat.type === 'channel') return;
    if (!isPrivilegedUser(ctx.from.id)) return ctx.reply("⛔ Owner only!");
    const args = ctx.message.text.split(" ");
    if (args.length < 2) return ctx.reply(`❌ /checkcoins [user_id]`);
    const userId = parseInt(args[1]);
    if (isNaN(userId)) return ctx.reply(`❌ Invalid!`);
    const user = db.getUser(userId);
    await ctx.reply(`🪙 COINS\n👤 ${userId}\n🪙 ${user.coins}\n💎 ${user.tier}\n📦 ${user.vps.length}\n✅ ${user.verified?'✓':'✗'}\n🚫 ${user.isBlocked?'Ya':'Tidak'}`);
});

bot.command("addpremium", async (ctx) => {
    if (ctx.chat.type === 'channel') return;
    if (!isPrivilegedUser(ctx.from.id)) return ctx.reply("⛔ Owner only!");
    const args = ctx.message.text.split(" ");
    if (args.length < 3) return ctx.reply(`❌ /addpremium [user_id] [days]`);
    const userId = parseInt(args[1]), days = parseInt(args[2]);
    if (isNaN(userId) || isNaN(days)) return ctx.reply(`❌ Invalid!`);
    const expiry = await db.addPremiumDays(userId, days);
    await ctx.reply(`✅ PREMIUM ADDED!\n👤 ${userId}\n📅 ${days} hari\n📆 ${new Date(expiry).toLocaleDateString()}`);
});

bot.command("block", async (ctx) => {
    if (ctx.chat.type === 'channel') return;
    if (!isPrivilegedUser(ctx.from.id)) return ctx.reply("⛔ Owner only!");
    const args = ctx.message.text.split(" ");
    if (args.length < 2) return ctx.reply(`❌ /block [user_id]`);
    const userId = parseInt(args[1]);
    const user = db.getUser(userId);
    user.isBlocked = true;
    await db.save();
    await ctx.reply(`✅ User ${userId} diblokir!`);
});

bot.command("unblock", async (ctx) => {
    if (ctx.chat.type === 'channel') return;
    if (!isPrivilegedUser(ctx.from.id)) return ctx.reply("⛔ Owner only!");
    const args = ctx.message.text.split(" ");
    if (args.length < 2) return ctx.reply(`❌ /unblock [user_id]`);
    const userId = parseInt(args[1]);
    const user = db.getUser(userId);
    user.isBlocked = false;
    await db.save();
    await ctx.reply(`✅ User ${userId} dibuka!`);
});

bot.command("listall", async (ctx) => {
    if (ctx.chat.type === 'channel') return;
    if (!isPrivilegedUser(ctx.from.id)) return ctx.reply("⛔ Owner only!");
    const allVPS = await db.getAllVPS();
    if (allVPS.length === 0) return ctx.reply("📭 Tidak ada VPS.");
    
    let msg = `📊 SEMUA VPS\n━━━━━━━━━━━━━━━━━━━━\n📊 ${allVPS.length}\n\n`;
    for (const vps of allVPS) {
        const user = db.getUser(vps.owner);
        const os = OS_OPTIONS[vps.os];
        const remaining = vps.expiresAt ? Math.max(0, Math.floor((new Date(vps.expiresAt).getTime() - Date.now()) / 60000)) : '♾️';
        msg += `${os.emoji} ${vps.id.slice(0,8)}\n├ 👤 ${vps.owner} (${user?.tier||'UNKNOWN'})\n├ 🌏 ${vps.regionFlag||'🌍'} ${vps.regionName||'Unknown'}\n├ 📊 ${vps.status}\n├ 💾 ${vps.ram}GB\n└ ⏰ ${remaining!=='♾️'?remaining+'m':'♾️'}\n\n`;
    }
    await ctx.reply(msg);
});

bot.command("deletevps", async (ctx) => {
    if (ctx.chat.type === 'channel') return;
    if (!isPrivilegedUser(ctx.from.id)) return ctx.reply("⛔ Owner only!");
    const args = ctx.message.text.split(" ");
    if (args.length < 2) return ctx.reply(`❌ /deletevps [vps_id]`);
    const vpsId = args[1];
    
    let foundKey = null, foundVps = null;
    for (const [key, vps] of Object.entries(db.data.vps)) {
        if (vps.id.startsWith(vpsId)) { foundKey = key; foundVps = vps; break; }
    }
    if (!foundKey) return ctx.reply(`❌ VPS tidak ditemukan!`);
    
    if (foundVps.containerId) {
        try {
            await execPromise(`docker stop ${foundVps.containerId} 2>/dev/null || true`);
            await execPromise(`docker rm ${foundVps.containerId} 2>/dev/null || true`);
        } catch (e) {}
    }
    await db.deleteVPS(foundKey);
    await ctx.reply(`✅ VPS ${vpsId.slice(0,8)} dihapus! Owner: ${foundVps.owner}`);
});

bot.command("upgradeddos", async (ctx) => {
    if (ctx.chat.type === 'channel') return;
    if (!isPrivilegedUser(ctx.from.id)) return ctx.reply("⛔ Owner only!");
    const args = ctx.message.text.split(" ");
    if (args.length < 2) return ctx.reply(`❌ /upgradeddos [vps_id]`);
    const vpsId = args[1];
    
    let foundKey = null;
    for (const [key, vps] of Object.entries(db.data.vps)) {
        if (vps.id.startsWith(vpsId)) { foundKey = key; break; }
    }
    if (!foundKey) return ctx.reply(`❌ VPS tidak ditemukan!`);
    
    const newLevel = await db.upgradeAntiDDoS(foundKey);
    if (newLevel) {
        await ctx.reply(`🛡️ DDOS UPGRADED!\n🆔 ${vpsId.slice(0,8)}\n📈 Level ${newLevel}/10`);
    } else {
        await ctx.reply(`❌ Gagal upgrade!`);
    }
});

bot.command("stats", async (ctx) => {
    if (ctx.chat.type === 'channel') return;
    if (!isPrivilegedUser(ctx.from.id)) return ctx.reply("⛔ Owner only!");
    
    const users = await db.getAllUsers();
    const vpsList = await db.getAllVPS();
    const totalCoins = Object.values(users).reduce((sum, u) => sum + (u.coins || 0), 0);
    const premiumUsers = Object.values(users).filter(u => u.tier === "PREMIUM").length;
    const ownerUsers = Object.values(users).filter(u => u.tier === "OWNER").length;
    const freeUsers = Object.values(users).filter(u => u.tier === "FREE").length;
    const blockedUsers = Object.values(users).filter(u => u.isBlocked).length;
    const verifiedUsers = Object.values(users).filter(u => u.verified === true).length;
    const stats = db.getSystemStats();
    const activeUsers = db.getActiveUsers().length;
    const totalReferrals = Object.values(users).reduce((sum, u) => sum + (u.referralCount || 0), 0);
    
    await ctx.reply(
        `📊 STATS\n━━━━━━━━━━━━━━━━━━━━\n` +
        `${PROVIDER}\n━━━━━━━━━━━━━━━━━━━━\n` +
        `👥 ${Object.keys(users).length} Users (${activeUsers} aktif)\n` +
        `✅ ${verifiedUsers} Verified\n` +
        `👑 ${ownerUsers}\n💎 ${premiumUsers}\n🆓 ${freeUsers}\n🚫 ${blockedUsers}\n` +
        `🖥️ ${vpsList.length} VPS\n🪙 ${totalCoins} Coins\n👥 ${totalReferrals} Referral\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🖥️ CPU ${stats.cpu}%\n💾 RAM ${stats.usedRam}GB/${stats.totalRam}GB (${stats.ram}%)\n💿 Disk ${stats.usedDisk}GB/${stats.totalDisk}GB (${stats.disk}%)\n` +
        `━━━━━━━━━━━━━━━━━━━━\n📅 ${new Date().toLocaleString()}`
    );
});

bot.command("users", async (ctx) => {
    if (ctx.chat.type === 'channel') return;
    if (!isPrivilegedUser(ctx.from.id)) return ctx.reply("⛔ Owner only!");
    
    const users = await db.getAllUsers();
    let msg = `👥 USER\n━━━━━━━━━━━━━━━━━━━━\n`;
    for (const [userId, user] of Object.entries(users)) {
        const emoji = user.tier === "OWNER" ? "👑" : user.tier === "PREMIUM" ? "💎" : "🆓";
        msg += `${emoji} ${userId}\n├ ${user.tier}\n├ 🪙 ${user.coins}\n├ 📦 ${user.vps?.length||0}\n├ ✅ ${user.verified?'✓':'✗'}\n├ 🚫 ${user.isBlocked?'Ya':'Tidak'}\n└ 👥 ${user.referralCount||0}\n\n`;
    }
    await ctx.reply(msg);
});

bot.command("help", async (ctx) => {
    if (ctx.chat.type === 'channel') return;
    const isAdmin = isPrivilegedUser(ctx.from.id);
    let msg =
        `📚 HELP\n━━━━━━━━━━━━━━━━━━━━\n` +
        `🖥️ /cvps [os] [region]\n` +
        `📋 /list\n📊 /monitor\n/delete [id]\n/regen_ssh [id]\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `⏰ /extend [id]\n📦 /module [id] [module]\n🌏 /region [id]\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `💰 /daily\n🎯 /referral\n🏆 /topreferral\n💎 /premium\n/buy_premium\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🖥️ /qemu\n/qemu_video\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📩 /msg [pesan]`;
    
    if (isAdmin) {
        msg += 
            `\n━━━━━━━━━━━━━━━━━━━━\n` +
            `🔐 ADMIN\n` +
            `/admin\n/list_users\n/user_info [id]\n` +
            `/delete_all_vps\n/stop_all_vps\n` +
            `/broadcast [pesan]\n` +
            `/addcoins [id] [amount]\n` +
            `/removecoins [id] [amount]\n` +
            `/checkcoins [id]\n` +
            `/addpremium [id] [days]\n` +
            `/block [id]\n/unblock [id]\n` +
            `/listall\n/deletevps [id]\n` +
            `/upgradeddos [id]\n/stats\n/users`;
    }
    await ctx.reply(msg);
});

bot.catch((err, ctx) => {
    console.error('Bot error:', err);
    if (ctx && ctx.reply) {
        ctx.reply('❌ Error. Coba lagi.');
    }
});

console.log('🚀 Starting VPS Bot...');
console.log(`☁️ ${PROVIDER}`);
console.log(`📊 Database: database.json`);
console.log(`👥 Users: ${Object.keys(db.data.users).length}`);
console.log(`🖥️ VPS: ${Object.keys(db.data.vps).length}`);
console.log(`👑 Owner ID: ${ADMIN_IDS[0]}`);
console.log(`🔐 Verify: ${VERIFY_CHANNEL}`);
console.log(`🎁 Daily: ${DAILY_REWARD} coins`);
console.log(`💰 Create: ${CREATE_VPS_COST} coins`);
console.log(`💰 Extend: ${EXTEND_COST} coins`);

bot.launch().then(() => {
    console.log('✅ Bot is running!');
}).catch(err => {
    console.error('❌ Failed to start bot:', err);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

module.exports = bot;
