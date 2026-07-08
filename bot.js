const { Telegraf, Markup } = require("telegraf");
const fs = require("fs").promises;
const path = require("path");
const crypto = require("crypto");
const { exec } = require("child_process");
const util = require("util");
const os = require("os");
const execPromise = util.promisify(exec);

const TOKEN = "8975199255:AAE0clzEOKDRwyDY09Hka7AG_wRH8MRW1i0";
const ADMIN_IDS = [7285215691];
const BOT_IMAGE = "https://www.jaky.dev/portfolio.jpeg";
const PROVIDER = "☁️ JKSoft Cloud System";
const DB_FILE = "/data/database.json";

const REGIONS = [
    { key: "singapore", name: "Singapore", flag: "🇸🇬", location: "1.2897,103.8501", country: "SG", city: "Singapore", timezone: "Asia/Singapore" },
    { key: "indonesia", name: "Indonesia (Jakarta)", flag: "🇮🇩", location: "-6.2088,106.8456", country: "ID", city: "Jakarta", timezone: "Asia/Jakarta" },
    { key: "malaysia", name: "Malaysia (Kuala Lumpur)", flag: "🇲🇾", location: "3.1390,101.6869", country: "MY", city: "Kuala Lumpur", timezone: "Asia/Kuala_Lumpur" },
    { key: "thailand", name: "Thailand (Bangkok)", flag: "🇹🇭", location: "13.7563,100.5018", country: "TH", city: "Bangkok", timezone: "Asia/Bangkok" },
    { key: "vietnam", name: "Vietnam (Ho Chi Minh)", flag: "🇻🇳", location: "10.8231,106.6297", country: "VN", city: "Ho Chi Minh", timezone: "Asia/Ho_Chi_Minh" }
];

const OS_OPTIONS = [
    { key: "ubuntu22", name: "Ubuntu 22.04 LTS", emoji: "🐧", image: "ubuntu-vps:22.04" },
    { key: "ubuntu24", name: "Ubuntu 24.04 LTS", emoji: "🐧", image: "ubuntu-vps:24.04" },
    { key: "debian11", name: "Debian 11 Bullseye", emoji: "🦕", image: "debian-vps:11" },
    { key: "debian12", name: "Debian 12 Bookworm", emoji: "🦕", image: "debian-vps:12" },
    { key: "debian13", name: "Debian 13 Trixie", emoji: "🦕", image: "debian-vps:13" }
];

const RAM_OPTIONS = [
    { name: "2GB", detail: "2048 MB" },
    { name: "4GB", detail: "4096 MB" },
    { name: "8GB", detail: "8192 MB" },
    { name: "16GB", detail: "16384 MB" }
];

const DISK_OPTIONS = [
    { name: "64GB" },
    { name: "128GB" },
    { name: "192GB" },
    { name: "256GB" }
];

const CPU_OPTIONS = [
    { name: "1 Core" },
    { name: "2 Core" },
    { name: "4 Core" },
    { name: "8 Core" }
];

class Database {
    constructor() {
        this.data = { vps: {} };
    }
    async load() {
        try {
            await fs.mkdir(path.dirname(DB_FILE), { recursive: true });
            const data = await fs.readFile(DB_FILE, "utf8");
            this.data = JSON.parse(data);
        } catch {
            await this.save();
        }
    }
    async save() {
        await fs.mkdir(path.dirname(DB_FILE), { recursive: true });
        await fs.writeFile(DB_FILE, JSON.stringify(this.data, null, 2));
    }
    async createVPS(osKey, regionKey, ram, disk, cpu) {
        const vpsId = crypto.randomBytes(4).toString("hex");
        const regionData = REGIONS.find(r => r.key === regionKey);
        const osData = OS_OPTIONS.find(o => o.key === osKey);
        const vps = {
            id: vpsId,
            os: osKey,
            osName: osData ? osData.name : osKey,
            osEmoji: osData ? osData.emoji : "🐧",
            region: regionKey,
            regionName: regionData ? regionData.name : "Unknown",
            regionFlag: regionData ? regionData.flag : "🌍",
            regionLocation: regionData ? regionData.location : "0,0",
            regionCountry: regionData ? regionData.country : "XX",
            regionCity: regionData ? regionData.city : "Unknown",
            regionTimezone: regionData ? regionData.timezone : "UTC",
            ram: ram,
            disk: disk,
            cpu: cpu,
            provider: PROVIDER,
            status: "deploying",
            createdAt: new Date().toISOString(),
            sshCommand: null,
            containerId: null
        };
        this.data.vps[vpsId] = vps;
        await this.save();
        return vps;
    }
    async deleteVPS(vpsId) {
        if (this.data.vps[vpsId]) {
            delete this.data.vps[vpsId];
            await this.save();
            return true;
        }
        return false;
    }
    async updateVPSSSH(vpsId, sshCommand) {
        if (this.data.vps[vpsId]) {
            this.data.vps[vpsId].sshCommand = sshCommand;
            await this.save();
        }
    }
    async updateVPSStatus(vpsId, status) {
        if (this.data.vps[vpsId]) {
            this.data.vps[vpsId].status = status;
            await this.save();
        }
    }
    getAllVPS() {
        return Object.values(this.data.vps);
    }
    getVPS(vpsId) {
        return this.data.vps[vpsId];
    }
}

const db = new Database();
const bot = new Telegraf(TOKEN);
const sessions = {};

function getSession(userId) {
    if (!sessions[userId]) {
        sessions[userId] = { state: "idle", selectedOS: null, selectedRegion: null, selectedRAM: null, selectedDisk: null, selectedCPU: null, selectedVPSId: null };
    }
    return sessions[userId];
}

function isAdmin(userId) {
    return ADMIN_IDS.includes(userId);
}

function getSystemStats() {
    const totalRam = os.totalmem() / (1024 ** 3);
    const freeRam = os.freemem() / (1024 ** 3);
    const usedRam = totalRam - freeRam;
    const cpuLoad = os.loadavg()[0];
    const cpuCount = os.cpus().length;
    return {
        cpu: Math.min(Math.round((cpuLoad / cpuCount) * 100), 100),
        ram: Math.round((usedRam / totalRam) * 100),
        totalRam: totalRam.toFixed(1),
        usedRam: usedRam.toFixed(1),
        disk: 15,
        totalDisk: 320,
        usedDisk: 48
    };
}

function getUptime() {
    const uptime = process.uptime();
    const days = Math.floor(uptime / 86400);
    const hours = Math.floor((uptime % 86400) / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    return `${days}d ${hours}h ${minutes}m`;
}

async function getTmateSSH(containerId) {
    try {
        const { stdout: check } = await execPromise(`docker exec ${containerId} ps aux | grep tmate | grep -v grep || echo ""`);
        if (!check.trim()) {
            await execPromise(`docker exec ${containerId} tmate -S /tmp/tmate.sock new-session -d 2>/dev/null || true`);
            await execPromise(`docker exec ${containerId} tmate -S /tmp/tmate.sock wait tmate-ready 2>/dev/null || true`);
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
        const { stdout } = await execPromise(`docker exec ${containerId} tmate -S /tmp/tmate.sock display -p "#{tmate_ssh}" 2>/dev/null || echo ""`);
        if (stdout.trim()) {
            return stdout.trim();
        }
        return null;
    } catch {
        return null;
    }
}

async function startTmateSession(containerId) {
    try {
        await execPromise(`docker exec ${containerId} apt update -y && apt install -y tmate 2>/dev/null || true`);
        const result = await getTmateSSH(containerId);
        return result;
    } catch {
        return null;
    }
}

async function injectRegionToContainer(containerId, regionKey) {
    const region = REGIONS.find(r => r.key === regionKey);
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
        " 2>/dev/null || true`);
    } catch {}
}

async function getDashboardText() {
    const stats = getSystemStats();
    const vpsList = db.getAllVPS();
    const activeVPS = vpsList.filter(v => v.status === "running").length;
    const uptime = getUptime();

    return `<b>☁️ MAIN DASHBOARD</b>\n` +
           `━━━━━━━━━━━━━━━━━━━━\n` +
           `🤖 <b>Sistem Uptime:</b> <code>${uptime}</code>\n` +
           `🖥️ <b>CPU Load:</b> <code>${stats.cpu}%</code>\n` +
           `💾 <b>RAM Usage:</b> <code>${stats.usedRam}GB / ${stats.totalRam}GB (${stats.ram}%)</code>\n` +
           `💿 <b>Disk Usage:</b> <code>${stats.usedDisk}GB / ${stats.totalDisk}GB (${stats.disk}%)</code>\n` +
           `━━━━━━━━━━━━━━━━━━━━\n` +
           `📦 <b>Total VPS:</b> <code>${vpsList.length} Unit</code>\n` +
           `🟢 <b>VPS Running:</b> <code>${activeVPS} Unit</code>\n` +
           `🔴 <b>VPS Stopped:</b> <code>${vpsList.length - activeVPS} Unit</code>\n` +
           `━━━━━━━━━━━━━━━━━━━━\n` +
           `<i>Gunakan menu di bawah untuk mengelola VPS Anda secara interaktif.</i>`;
}

function getDashboardButtons() {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback("🖥️ Buat VPS", "create_vps"),
            Markup.button.callback("📋 List VPS", "list_vps")
        ],
        [
            Markup.button.callback("🔄 Refresh Status", "refresh_dashboard")
        ]
    ]);
}

bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    if (!isAdmin(userId)) {
        return ctx.reply("⛔ <b>Akses Ditolak!</b>\nBot ini khusus digunakan oleh Owner.", { parse_mode: "HTML" });
    }
    await next();
});

bot.command("start", async (ctx) => {
    const userId = ctx.from.id;
    const session = getSession(userId);
    session.state = "idle";
    const text = await getDashboardText();
    await ctx.replyWithPhoto(BOT_IMAGE, {
        caption: text,
        parse_mode: "HTML",
        ...getDashboardButtons()
    });
});

bot.action("refresh_dashboard", async (ctx) => {
    await ctx.answerCbQuery("Status Terupdate!");
    const text = await getDashboardText();
    await ctx.editMessageCaption(text, {
        parse_mode: "HTML",
        ...getDashboardButtons()
    });
});

bot.action("main_menu", async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const session = getSession(userId);
    session.state = "idle";
    const text = await getDashboardText();
    await ctx.editMessageCaption(text, {
        parse_mode: "HTML",
        ...getDashboardButtons()
    });
});

bot.action("create_vps", async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const session = getSession(userId);
    session.state = "choose_os";

    let text = `<b>🖥️ PILIH OPERATING SYSTEM (OS)</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
    OS_OPTIONS.forEach((os, idx) => {
        text += `${idx + 1}. <b>${os.emoji} ${os.name}</b> (<code>${os.key}</code>)\n`;
    });
    text += `━━━━━━━━━━━━━━━━━━━━\n<i>Silakan pilih nomor sistem operasi yang ingin Anda install.</i>`;

    const buttons = [];
    let row = [];
    OS_OPTIONS.forEach((os, idx) => {
        row.push(Markup.button.callback(`${idx + 1}`, `set_os_${idx}`));
        if (row.length === 3) {
            buttons.push(row);
            row = [];
        }
    });
    if (row.length > 0) buttons.push(row);
    buttons.push([Markup.button.callback("↩️ Kembali ke Dashboard", "main_menu")]);

    await ctx.editMessageCaption(text, {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard(buttons)
    });
});

OS_OPTIONS.forEach((os, osIdx) => {
    bot.action(`set_os_${osIdx}`, async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        const session = getSession(userId);
        session.selectedOS = os.key;
        session.state = "choose_region";

        let text = `<b>🌏 PILIH LOKASI / REGION VPS</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
        REGIONS.forEach((region, idx) => {
            text += `${idx + 1}. <b>${region.flag} ${region.name}</b> (<code>${region.key}</code>)\n`;
        });
        text += `━━━━━━━━━━━━━━━━━━━━\n`;
        text += `💿 <b>OS Terpilih:</b> <code>${os.name}</code>\n`;
        text += `━━━━━━━━━━━━━━━━━━━━\n<i>Silakan pilih nomor lokasi server untuk dideploy.</i>`;

        const buttons = [];
        let row = [];
        REGIONS.forEach((reg, idx) => {
            row.push(Markup.button.callback(`${idx + 1}`, `set_region_${idx}`));
            if (row.length === 3) {
                buttons.push(row);
                row = [];
            }
        });
        if (row.length > 0) buttons.push(row);
        buttons.push([
            Markup.button.callback("↩️ Back (Pilih OS)", "create_vps"),
            Markup.button.callback("📋 Menu Utama", "main_menu")
        ]);

        await ctx.editMessageCaption(text, {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard(buttons)
        });
    });
});

REGIONS.forEach((region, regIdx) => {
    bot.action(`set_region_${regIdx}`, async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        const session = getSession(userId);
        session.selectedRegion = region.key;
        session.state = "choose_ram";

        const osData = OS_OPTIONS.find(o => o.key === session.selectedOS);

        let text = `<b>💾 PILIH MEMORY / RAM VPS</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
        RAM_OPTIONS.forEach((ram, idx) => {
            text += `${idx + 1}. <b>${ram.name}</b> (<code>${ram.detail}</code>)\n`;
        });
        text += `━━━━━━━━━━━━━━━━━━━━\n`;
        text += `💿 <b>OS Terpilih:</b> <code>${osData.name}</code>\n`;
        text += `🌏 <b>Region Terpilih:</b> <code>${region.flag} ${region.name}</code>\n`;
        text += `━━━━━━━━━━━━━━━━━━━━\n<i>Silakan pilih nomor kapasitas RAM yang Anda inginkan.</i>`;

        const buttons = [];
        let row = [];
        RAM_OPTIONS.forEach((ram, idx) => {
            row.push(Markup.button.callback(`${idx + 1}`, `set_ram_${idx}`));
            if (row.length === 4) {
                buttons.push(row);
                row = [];
            }
        });
        if (row.length > 0) buttons.push(row);
        buttons.push([
            Markup.button.callback("↩️ Back (Pilih Region)", `set_os_${OS_OPTIONS.findIndex(o => o.key === session.selectedOS)}`),
            Markup.button.callback("📋 Menu Utama", "main_menu")
        ]);

        await ctx.editMessageCaption(text, {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard(buttons)
        });
    });
});

RAM_OPTIONS.forEach((ram, ramIdx) => {
    bot.action(`set_ram_${ramIdx}`, async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        const session = getSession(userId);
        session.selectedRAM = ram.name;
        session.state = "choose_disk";

        const osData = OS_OPTIONS.find(o => o.key === session.selectedOS);
        const regionData = REGIONS.find(r => r.key === session.selectedRegion);

        let text = `<b>💿 PILIH KAPASITAS DISK VPS</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
        DISK_OPTIONS.forEach((disk, idx) => {
            text += `${idx + 1}. <b>${disk.name} SSD Storage</b>\n`;
        });
        text += `━━━━━━━━━━━━━━━━━━━━\n`;
        text += `💿 <b>OS Terpilih:</b> <code>${osData.name}</code>\n`;
        text += `🌏 <b>Region Terpilih:</b> <code>${regionData.flag} ${regionData.name}</code>\n`;
        text += `💾 <b>RAM Terpilih:</b> <code>${session.selectedRAM} (${ram.detail})</code>\n`;
        text += `━━━━━━━━━━━━━━━━━━━━\n<i>Silakan pilih nomor kapasitas media penyimpanan SSD.</i>`;

        const buttons = [];
        let row = [];
        DISK_OPTIONS.forEach((disk, idx) => {
            row.push(Markup.button.callback(`${idx + 1}`, `set_disk_${idx}`));
            if (row.length === 4) {
                buttons.push(row);
                row = [];
            }
        });
        if (row.length > 0) buttons.push(row);
        buttons.push([
            Markup.button.callback("↩️ Back (Pilih RAM)", `set_region_${REGIONS.findIndex(r => r.key === session.selectedRegion)}`),
            Markup.button.callback("📋 Menu Utama", "main_menu")
        ]);

        await ctx.editMessageCaption(text, {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard(buttons)
        });
    });
});

DISK_OPTIONS.forEach((disk, diskIdx) => {
    bot.action(`set_disk_${diskIdx}`, async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        const session = getSession(userId);
        session.selectedDisk = disk.name;
        session.state = "choose_cpu";

        const osData = OS_OPTIONS.find(o => o.key === session.selectedOS);
        const regionData = REGIONS.find(r => r.key === session.selectedRegion);
        const ramData = RAM_OPTIONS.find(rm => rm.name === session.selectedRAM);

        let text = `<b>⚡ PILIH CORE CPU VPS</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
        CPU_OPTIONS.forEach((cpu, idx) => {
            text += `${idx + 1}. <b>${cpu.name} Processor</b>\n`;
        });
        text += `━━━━━━━━━━━━━━━━━━━━\n`;
        text += `💿 <b>OS Terpilih:</b> <code>${osData.name}</code>\n`;
        text += `🌏 <b>Region Terpilih:</b> <code>${regionData.flag} ${regionData.name}</code>\n`;
        text += `💾 <b>RAM Terpilih:</b> <code>${session.selectedRAM} (${ramData.detail})</code>\n`;
        text += `💿 <b>Disk Terpilih:</b> <code>${session.selectedDisk}</code>\n`;
        text += `━━━━━━━━━━━━━━━━━━━━\n<i>Silakan pilih nomor alokasi virtual core processor.</i>`;

        const buttons = [];
        let row = [];
        CPU_OPTIONS.forEach((cpu, idx) => {
            row.push(Markup.button.callback(`${idx + 1}`, `set_cpu_${idx}`));
            if (row.length === 4) {
                buttons.push(row);
                row = [];
            }
        });
        if (row.length > 0) buttons.push(row);
        buttons.push([
            Markup.button.callback("↩️ Back (Pilih Disk)", `set_ram_${RAM_OPTIONS.findIndex(rm => rm.name === session.selectedRAM)}`),
            Markup.button.callback("📋 Menu Utama", "main_menu")
        ]);

        await ctx.editMessageCaption(text, {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard(buttons)
        });
    });
});

CPU_OPTIONS.forEach((cpu, cpuIdx) => {
    bot.action(`set_cpu_${cpuIdx}`, async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        const session = getSession(userId);
        session.selectedCPU = cpu.name;
        session.state = "confirm_vps";

        const osData = OS_OPTIONS.find(o => o.key === session.selectedOS);
        const regionData = REGIONS.find(r => r.key === session.selectedRegion);
        const ramData = RAM_OPTIONS.find(rm => rm.name === session.selectedRAM);

        let text = `<b>⚠️ KONFIRMASI PEMBUATAN VPS</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
                   `💿 <b>Sistem Operasi:</b> <code>${osData.emoji} ${osData.name}</code>\n` +
                   `🌏 <b>Region Server:</b> <code>${regionData.flag} ${regionData.name}</code>\n` +
                   `💾 <b>Alokasi RAM:</b> <code>${session.selectedRAM} (${ramData.detail})</code>\n` +
                   `💿 <b>Kapasitas Disk:</b> <code>${session.selectedDisk}</code>\n` +
                   `⚡ <b>Inti Processor:</b> <code>${session.selectedCPU}</code>\n` +
                   `💼 <b>Developer:</b> <code>${PROVIDER}</code>\n` +
                   `━━━━━━━━━━━━━━━━━━━━\n` +
                   `<i>Apakah spesifikasi pembuatan VPS di atas sudah benar? Tekan Deploy untuk memulai proses.</i>`;

        const buttons = [
            [
                Markup.button.callback("🚀 Mulai Deploy", "execute_deploy"),
                Markup.button.callback("❌ Batalkan", "main_menu")
            ],
            [
                Markup.button.callback("↩️ Back (Pilih CPU)", `set_disk_${DISK_OPTIONS.findIndex(d => d.name === session.selectedDisk)}`)
            ]
        ];

        await ctx.editMessageCaption(text, {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard(buttons)
        });
    });
});

bot.action("execute_deploy", async (ctx) => {
    await ctx.answerCbQuery("Memulai deploy VPS...");
    const userId = ctx.from.id;
    const session = getSession(userId);
    session.state = "deploying";

    const osData = OS_OPTIONS.find(o => o.key === session.selectedOS);
    const regionData = REGIONS.find(r => r.key === session.selectedRegion);

    await ctx.editMessageCaption(
        `<b>⏳ SEDANG MEMBANGUN VPS...</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
        `💿 <b>OS:</b> <code>${osData.name}</code>\n` +
        `🌏 <b>Region:</b> <code>${regionData.flag} ${regionData.name}</code>\n` +
        `💾 <b>RAM:</b> <code>${session.selectedRAM}</code>\n` +
        `💿 <b>Disk:</b> <code>${session.selectedDisk}</code>\n` +
        `⚡ <b>CPU:</b> <code>${session.selectedCPU}</code>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `<i>Sistem sedang menyiapkan container docker dan menginstalasi modul pendukung. Harap tunggu sebentar...</i>`,
        { parse_mode: "HTML" }
    );

    try {
        const vps = await db.createVPS(session.selectedOS, session.selectedRegion, session.selectedRAM, session.selectedDisk, session.selectedCPU);
        const cmd = `docker run -d --name vps_${vps.id} --privileged ${osData.image}`;
        const { stdout } = await execPromise(cmd);
        vps.containerId = stdout.trim();
        vps.status = "running";
        await db.save();

        await injectRegionToContainer(vps.containerId, session.selectedRegion);
        const sshCommand = await startTmateSession(vps.containerId);

        if (sshCommand) {
            vps.sshCommand = sshCommand;
            await db.save();

            let successText = `<b>✅ VPS BERHASIL DIDEPLOY!</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
                              `🆔 <b>ID VPS:</b> <code>${vps.id}</code>\n` +
                              `💿 <b>OS:</b> <code>${osData.emoji} ${osData.name}</code>\n` +
                              `🌏 <b>Lokasi:</b> <code>${regionData.flag} ${regionData.name}</code>\n` +
                              `💾 <b>RAM:</b> <code>${session.selectedRAM}</code>\n` +
                              `💿 <b>Disk:</b> <code>${session.selectedDisk}</code>\n` +
                              `⚡ <b>CPU:</b> <code>${session.selectedCPU}</code>\n` +
                              `🟢 <b>Status:</b> <code>Running</code>\n` +
                              `━━━━━━━━━━━━━━━━━━━━\n` +
                              `🔑 <b>SSH (Tmate Command):</b>\n<code>${sshCommand}</code>\n` +
                              `━━━━━━━━━━━━━━━━━━━━\n` +
                              `<i>Gunakan perintah SSH di atas untuk mengakses VPS Anda sekarang.</i>`;

            await ctx.editMessageCaption(successText, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("📋 Kelola VPS", `manage_vps_${vps.id}`)],
                    [Markup.button.callback("↩️ Menu Utama", "main_menu")]
                ])
            });
        } else {
            await ctx.editMessageCaption(
                `<b>⚠️ VPS BERHASIL DIBUAT DENGAN LIMITASI</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
                `Container berhasil jalan namun sistem gagal mendapatkan SSH Tmate secara otomatis.\n` +
                `Silakan lakukan regenerasi SSH pada menu management.\n\n` +
                `🆔 <b>ID VPS:</b> <code>${vps.id}</code>`,
                {
                    parse_mode: "HTML",
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback("📋 Masuk Management", `manage_vps_${vps.id}`)],
                        [Markup.button.callback("↩️ Menu Utama", "main_menu")]
                    ])
                }
            );
        }
    } catch (err) {
        await ctx.editMessageCaption(
            `<b>❌ GAGAL DEPLOY VPS</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
            `Terjadi kesalahan fatal saat melakukan deploy container.\n\n` +
            `💬 <b>Error:</b> <code>${err.message}</code>`,
            {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([[Markup.button.callback("↩️ Kembali ke Dashboard", "main_menu")]])
            }
        );
    }
});

bot.action("list_vps", async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const session = getSession(userId);
    session.state = "list_vps";

    const vpsList = db.getAllVPS();
    if (vpsList.length === 0) {
        return ctx.editMessageCaption(
            `<b>📭 TIDAK ADA VPS AKTIF</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
            `Anda saat ini belum memiliki VPS yang dideploy.\n` +
            `Gunakan menu buat VPS untuk memulai server baru.`,
            {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([[Markup.button.callback("↩️ Menu Utama", "main_menu")]])
            }
        );
    }

    let text = `<b>📋 LIST VPS SAYA (${vpsList.length} Unit)</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
    vpsList.forEach((vps, index) => {
        const osData = OS_OPTIONS.find(o => o.key === vps.os);
        const statusEmoji = vps.status === "running" ? "🟢" : "🔴";
        text += `${index + 1}. <b>${statusEmoji} ID: <code>${vps.id}</code></b>\n` +
                `   ├ 📦 OS: <code>${osData ? osData.name : vps.os}</code>\n` +
                `   └ 🌏 Region: <code>${vps.regionFlag} ${vps.regionName}</code>\n\n`;
    });
    text += `━━━━━━━━━━━━━━━━━━━━\n<i>Pilih nomor di bawah ini untuk mengelola VPS Anda secara spesifik.</i>`;

    const buttons = [];
    let row = [];
    vpsList.forEach((vps, idx) => {
        row.push(Markup.button.callback(`${idx + 1}`, `manage_vps_${vps.id}`));
        if (row.length === 4) {
            buttons.push(row);
            row = [];
        }
    });
    if (row.length > 0) buttons.push(row);
    buttons.push([Markup.button.callback("↩️ Kembali ke Dashboard", "main_menu")]);

    await ctx.editMessageCaption(text, {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard(buttons)
    });
});

bot.action(/^manage_vps_(.+)$/, async (ctx) => {
    const vpsId = ctx.match[1];
    await ctx.answerCbQuery(`Mengakses VPS: ${vpsId}`);
    await renderVPSManagement(ctx, vpsId);
});

async function renderVPSManagement(ctx, vpsId, isRefresh = false) {
    const userId = ctx.from.id;
    const session = getSession(userId);
    session.state = `manage_vps`;
    session.selectedVPSId = vpsId;

    const vps = db.getVPS(vpsId);
    if (!vps) {
        return ctx.editMessageCaption(
            `<b>❌ VPS TIDAK DITEMUKAN</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
            `Data VPS dengan ID <code>${vpsId}</code> sudah dihapus atau tidak terdaftar di sistem.`,
            {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([[Markup.button.callback("📋 Kembali ke List", "list_vps")]])
            }
        );
    }

    let dockerStats = { cpu: "0.00%", memory: "0MB / 0MB", memPercent: "0.00%" };
    if (vps.containerId) {
        try {
            const { stdout } = await execPromise(`docker stats --no-stream --format "{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}" ${vps.containerId} 2>/dev/null || echo "0%|0B/0B|0%"`);
            const parts = stdout.trim().split("|");
            if (parts.length === 3) {
                dockerStats.cpu = parts[0];
                dockerStats.memory = parts[1];
                dockerStats.memPercent = parts[2];
            }
        } catch {}
    }

    const createdDate = new Date(vps.createdAt).toLocaleString();
    const statusText = vps.status === "running" ? "🟢 Running" : "🔴 Stopped";

    let text = `<b>🛠️ KELOLA VPS: <code>${vps.id}</code></b>\n` +
               `━━━━━━━━━━━━━━━━━━━━\n` +
               `🟢 <b>Status Server:</b> <code>${statusText}</code>\n` +
               `💿 <b>OS Variant:</b> <code>${vps.osEmoji} ${vps.osName}</code>\n` +
               `🌏 <b>Region Server:</b> <code>${vps.regionFlag} ${vps.regionName}</code>\n` +
               `💾 <b>Alokasi RAM:</b> <code>${vps.ram || "2GB"}</code>\n` +
               `💿 <b>Kapasitas Disk:</b> <code>${vps.disk || "64GB"}</code>\n` +
               `⚡ <b>Inti Processor:</b> <code>${vps.cpu || "1 Core"}</code>\n` +
               `📅 <b>Dibuat Pada:</b> <code>${createdDate}</code>\n` +
               `━━━━━━━━━━━━━━━━━━━━\n` +
               `📊 <b>MONITORING CONTAINER VPS</b>\n` +
               `├ <b>CPU Core Usage:</b> <code>${dockerStats.cpu}</code>\n` +
               `└ <b>RAM Virtual Usage:</b> <code>${dockerStats.memory} (${dockerStats.memPercent})</code>\n` +
               `━━━━━━━━━━━━━━━━━━━━\n` +
               `🔑 <b>SSH (Tmate Command):</b>\n` +
               `<code>${vps.sshCommand || "Belum Dibuat / Regenerasikan"}</code>\n` +
               `━━━━━━━━━━━━━━━━━━━━\n` +
               `<i>Update real-time resource VPS Anda dengan menekan tombol refresh.</i>`;

    const buttons = [
        [
            Markup.button.callback("🔄 Refresh Info", `refresh_vps_${vps.id}`),
            Markup.button.callback("🔑 Regen SSH", `regen_ssh_${vps.id}`)
        ],
        [
            Markup.button.callback("🗑️ Hapus VPS", `confirm_delete_vps_${vps.id}`)
        ],
        [
            Markup.button.callback("↩️ Kembali ke List", "list_vps")
        ]
    ];

    if (isRefresh) {
        await ctx.editMessageCaption(text, {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard(buttons)
        });
    } else {
        await ctx.editMessageCaption(text, {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard(buttons)
        });
    }
}

bot.action(/^refresh_vps_(.+)$/, async (ctx) => {
    const vpsId = ctx.match[1];
    await ctx.answerCbQuery("Status Kontainer Diperbarui!");
    await renderVPSManagement(ctx, vpsId, true);
});

bot.action(/^regen_ssh_(.+)$/, async (ctx) => {
    const vpsId = ctx.match[1];
    await ctx.answerCbQuery("Menghubungi kontainer...");
    const vps = db.getVPS(vpsId);

    if (!vps || !vps.containerId) {
        return ctx.reply("❌ Kontainer tidak valid.");
    }

    await ctx.editMessageCaption(
        `<b>🔄 REGENERASI KUNCI SSH...</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
        `🆔 <b>ID VPS:</b> <code>${vps.id}</code>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `<i>Sedang merestart modul Tmate dan memproses alamat SSH baru untuk Anda. Harap tunggu...</i>`,
        { parse_mode: "HTML" }
    );

    try {
        await execPromise(`docker exec ${vps.containerId} pkill tmate 2>/dev/null || true`);
        await execPromise(`docker exec ${vps.containerId} rm -f /tmp/tmate.sock 2>/dev/null || true`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        const sshCommand = await startTmateSession(vps.containerId);

        if (sshCommand) {
            vps.sshCommand = sshCommand;
            await db.save();
            await renderVPSManagement(ctx, vpsId);
        } else {
            await ctx.editMessageCaption(
                `<b>❌ GAGAL MEMBUAT SSH</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
                `Kontainer menolak pembuatan socket baru atau tmate gagal berjalan di sistem container.`,
                {
                    parse_mode: "HTML",
                    ...Markup.inlineKeyboard([[Markup.button.callback("↩️ Kembali ke Panel VPS", `manage_vps_${vps.id}`)]])
                }
            );
        }
    } catch (err) {
        await ctx.editMessageCaption(
            `<b>❌ ERROR REGENERATE</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
            `<code>${err.message}</code>`,
            {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([[Markup.button.callback("↩️ Kembali ke Panel VPS", `manage_vps_${vps.id}`)]])
            }
        );
    }
});

bot.action(/^confirm_delete_vps_(.+)$/, async (ctx) => {
    const vpsId = ctx.match[1];
    await ctx.answerCbQuery();
    const vps = db.getVPS(vpsId);

    if (!vps) {
        return ctx.editMessageCaption(
            `<b>❌ DATA TIDAK DITEMUKAN</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
            `VPS sudah terhapus secara permanen dari basis data.`,
            {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([[Markup.button.callback("📋 Kembali ke List", "list_vps")]])
            }
        );
    }

    let text = `<b>🚨 KONFIRMASI PENGHAPUSAN VPS 🚨</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
               `Anda akan menghapus VPS berikut:\n` +
               `🆔 <b>ID VPS:</b> <code>${vps.id}</code>\n` +
               `💿 <b>OS:</b> <code>${vps.osEmoji} ${vps.osName}</code>\n` +
               `🌏 <b>Region:</b> <code>${vps.regionFlag} ${vps.regionName}</code>\n` +
               `💾 <b>RAM:</b> <code>${vps.ram || "2GB"}</code>\n` +
               `💿 <b>Disk:</b> <code>${vps.disk || "64GB"}</code>\n` +
               `⚡ <b>CPU:</b> <code>${vps.cpu || "1 Core"}</code>\n` +
               `━━━━━━━━━━━━━━━━━━━━\n` +
               `<b>🔴 WARNING:</b> Semua data, file, modul, dan konfigurasi di dalam VPS ini akan dihancurkan secara total dan permanen tanpa ada pencadangan!\n` +
               `━━━━━━━━━━━━━━━━━━━━\n` +
               `<i>Apakah Anda benar-benar ingin melanjutkan tindakan ini?</i>`;

    const buttons = [
        [
            Markup.button.callback("🔥 Ya, Hapus Sekarang", `execute_delete_vps_${vps.id}`),
            Markup.button.callback("❌ Tidak, Batalkan", `manage_vps_${vps.id}`)
        ]
    ];

    await ctx.editMessageCaption(text, {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard(buttons)
    });
});

bot.action(/^execute_delete_vps_(.+)$/, async (ctx) => {
    const vpsId = ctx.match[1];
    await ctx.answerCbQuery("Menghapus kontainer VPS...");
    const vps = db.getVPS(vpsId);

    if (vps) {
        if (vps.containerId) {
            try {
                await execPromise(`docker stop ${vps.containerId} 2>/dev/null || true`);
                await execPromise(`docker rm ${vps.containerId} 2>/dev/null || true`);
            } catch {}
        }
        await db.deleteVPS(vpsId);
    }

    let text = `<b>🔥 VPS BERHASIL DIHAPUS</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
               `Kontainer Docker dan informasi SSH untuk VPS ID <code>${vpsId}</code> telah dihancurkan dari host.\n\n` +
               `🧼 Ruang host dibebaskan kembali.`;

    const buttons = [
        [Markup.button.callback("📋 Kembali ke List VPS", "list_vps")],
        [Markup.button.callback("↩️ Dashboard Utama", "main_menu")]
    ];

    await ctx.editMessageCaption(text, {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard(buttons)
    });
});

bot.catch((err) => {
    console.error("Fatal Bot error:", err);
});

(async () => {
    await db.load();
    await bot.launch();
    console.log("🚀 JKSoft-VpsFree (Owner Version) Berhasil dijalankan!");
})();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
