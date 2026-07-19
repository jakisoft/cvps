const { Telegraf, Markup } = require("telegraf");
const fs = require("fs").promises;
const path = require("path");
const crypto = require("crypto");
const { exec } = require("child_process");
const util = require("util");
const os = require("os");
const net = require("net");
const http = require("http");
const execPromise = util.promisify(exec);

const TOKEN = "8975199255:AAE0clzEOKDRwyDY09Hka7AG_wRH8MRW1i0";
const ADMIN_IDS = [7285215691];
const BOT_IMAGE = "https://www.jaky.dev/portfolio.jpeg";
const PROVIDER = "☁️ JKSoft Cloud System";
const DB_FILE = "./data/database.json";

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
    async createVPS(osKey, ram, disk, cpu, sshPort, sftpPort, password, ipAddress) {
        const vpsId = crypto.randomBytes(4).toString("hex");
        const osData = OS_OPTIONS.find(o => o.key === osKey);
        const vps = {
            id: vpsId,
            os: osKey,
            osName: osData ? osData.name : osKey,
            osEmoji: osData ? osData.emoji : "🐧",
            ram: ram,
            disk: disk,
            cpu: cpu,
            provider: PROVIDER,
            status: "deploying",
            createdAt: new Date().toISOString(),
            sshCommand: null,
            containerId: null,
            sshPort: sshPort,
            sftpPort: sftpPort,
            password: password,
            ipAddress: ipAddress
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
let HOST_PUBLIC_IP = "127.0.0.1";

function fetchPublicIP() {
    return new Promise((resolve) => {
        const options = {
            host: "api.ipify.org",
            port: 80,
            path: "/",
            timeout: 5000
        };
        http.get(options, (res) => {
            let data = "";
            res.on("data", (chunk) => data += chunk);
            res.on("end", () => {
                const ip = data.trim();
                if (ip) resolve(ip);
                else resolve("127.0.0.1");
            });
        }).on("error", () => {
            http.get({ host: "ifconfig.me", port: 80, path: "/", timeout: 5000 }, (res2) => {
                let data2 = "";
                res2.on("data", (chunk) => data2 += chunk);
                res2.on("end", () => {
                    resolve(data2.trim() || "127.0.0.1");
                });
            }).on("error", () => resolve("127.0.0.1"));
        });
    });
}

async function getPublicIP() {
    try {
        const ip = await fetchPublicIP();
        if (ip && ip !== "127.0.0.1") {
            HOST_PUBLIC_IP = ip;
        } else {
            const { stdout } = await execPromise("curl -s ifconfig.me || curl -s api.ipify.org");
            if (stdout.trim()) {
                HOST_PUBLIC_IP = stdout.trim();
            }
        }
    } catch {}
}

function checkPortAvailable(port) {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once("error", () => resolve(false));
        server.once("listening", () => {
            server.close();
            resolve(true);
        });
        server.listen(port);
    });
}

async function generateValidPort() {
    while (true) {
        const port = crypto.randomInt(10000, 65535);
        const isAvailable = await checkPortAvailable(port);
        if (isAvailable) {
            const vpsList = db.getAllVPS();
            const conflict = vpsList.some(v => v.sshPort === port || v.sftpPort === port);
            if (!conflict) {
                return port;
            }
        }
    }
}

async function openHostPort(port) {
    const normalizedPort = Number(port);
    if (!Number.isInteger(normalizedPort) || normalizedPort < 1 || normalizedPort > 65535) {
        throw new Error(`Port host tidak valid: ${port}`);
    }

    const commands = [
        `iptables -C INPUT -p tcp --dport ${normalizedPort} -j ACCEPT 2>/dev/null || iptables -I INPUT -p tcp --dport ${normalizedPort} -j ACCEPT`,
        `ip6tables -C INPUT -p tcp --dport ${normalizedPort} -j ACCEPT 2>/dev/null || ip6tables -I INPUT -p tcp --dport ${normalizedPort} -j ACCEPT`,
        `if command -v ufw >/dev/null 2>&1 && ufw status | grep -qi active; then ufw allow ${normalizedPort}/tcp >/dev/null; fi`,
        `if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then firewall-cmd --permanent --add-port=${normalizedPort}/tcp >/dev/null && firewall-cmd --reload >/dev/null; fi`
    ];

    for (const command of commands) {
        try {
            await execPromise(command);
        } catch {}
    }
}

async function openHostVPSPorts(sshPort, sftpPort) {
    await openHostPort(sshPort);
    await openHostPort(sftpPort);
}

async function closeHostPort(port) {
    const normalizedPort = Number(port);
    if (!Number.isInteger(normalizedPort) || normalizedPort < 1 || normalizedPort > 65535) {
        return;
    }

    const commands = [
        `while iptables -C INPUT -p tcp --dport ${normalizedPort} -j ACCEPT 2>/dev/null; do iptables -D INPUT -p tcp --dport ${normalizedPort} -j ACCEPT; done`,
        `while ip6tables -C INPUT -p tcp --dport ${normalizedPort} -j ACCEPT 2>/dev/null; do ip6tables -D INPUT -p tcp --dport ${normalizedPort} -j ACCEPT; done`,
        `if command -v ufw >/dev/null 2>&1 && ufw status | grep -qi active; then ufw delete allow ${normalizedPort}/tcp >/dev/null 2>&1 || true; fi`,
        `if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then firewall-cmd --permanent --remove-port=${normalizedPort}/tcp >/dev/null 2>&1 || true; firewall-cmd --reload >/dev/null 2>&1 || true; fi`
    ];

    for (const command of commands) {
        try {
            await execPromise(command);
        } catch {}
    }
}

async function closeHostVPSPorts(sshPort, sftpPort) {
    await closeHostPort(sshPort);
    await closeHostPort(sftpPort);
}

function generateRandomPassword() {
    const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const lower = "abcdefghijklmnopqrstuvwxyz";
    const numbers = "0123456789";
    const special = "!@#$%^&*()_+-=[]{}|;:,.<>?";
    const all = upper + lower + numbers + special;
    let password = "";
    password += upper[crypto.randomInt(0, upper.length)];
    password += lower[crypto.randomInt(0, lower.length)];
    password += numbers[crypto.randomInt(0, numbers.length)];
    password += special[crypto.randomInt(0, special.length)];
    for (let i = 0; i < 6; i++) {
        password += all[crypto.randomInt(0, all.length)];
    }
    return password.split("").sort(() => 0.5 - Math.random()).join("");
}

function getSession(userId) {
    if (!sessions[userId]) {
        sessions[userId] = { state: "idle", selectedOS: null, selectedRAM: null, selectedDisk: null, selectedCPU: null, selectedVPSId: null };
    }
    return sessions[userId];
}

function shellQuote(value) {
    return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function isAdmin(userId) {
    return ADMIN_IDS.includes(userId);
}

async function getSystemStats() {
    const totalRam = os.totalmem() / (1024 ** 3);
    const freeRam = os.freemem() / (1024 ** 3);
    const usedRam = totalRam - freeRam;
    const cpuLoad = os.loadavg()[0];
    const cpuCount = os.cpus().length;
    let diskTotal = "N/A", diskUsed = "N/A", diskPercent = "0";
    try {
        const { stdout } = await execPromise("df -h / | tail -n 1");
        const parts = stdout.trim().split(/\s+/);
        if (parts.length >= 5) {
            diskTotal = parts[1];
            diskUsed = parts[2];
            diskPercent = parts[4].replace("%", "");
        }
    } catch {}
    return {
        cpu: Math.min(Math.round((cpuLoad / cpuCount) * 100), 100),
        ram: Math.round((usedRam / totalRam) * 100),
        totalRam: totalRam.toFixed(1),
        usedRam: usedRam.toFixed(1),
        disk: diskPercent,
        totalDisk: diskTotal,
        usedDisk: diskUsed
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
        await execPromise(`docker exec ${containerId} apt-get update -y && docker exec ${containerId} apt-get install -y tmate 2>/dev/null || true`);
        const result = await getTmateSSH(containerId);
        return result;
    } catch {
        return null;
    }
}

async function configureSSHAndSFTP(containerId, password, sshPort = 22, sftpPort = 2222) {
    const quotedPassword = shellQuote(password);
    const sshdPorts = [...new Set([22, 2222, Number(sshPort), Number(sftpPort)].filter(port => Number.isInteger(port) && port > 0))];
    const sshdConfig = [
        ...sshdPorts.map(port => `Port ${port}`),
        "ListenAddress 0.0.0.0",
        "PermitRootLogin yes",
        "PasswordAuthentication yes",
        "KbdInteractiveAuthentication no",
        "UsePAM yes",
        "Subsystem sftp /usr/lib/openssh/sftp-server"
    ].join("\n");
    const quotedConfig = shellQuote(sshdConfig);

    await execPromise(`docker exec ${containerId} bash -lc ${shellQuote(`
        set -e
        export DEBIAN_FRONTEND=noninteractive
        apt-get update -y
        apt-get install -y openssh-server iproute2
        mkdir -p /var/run/sshd /run/sshd
        printf '%s\n' root:${quotedPassword} | chpasswd
        printf '%s\n' ${quotedConfig} > /etc/ssh/sshd_config
        ssh-keygen -A
        pkill sshd 2>/dev/null || true
        /usr/sbin/sshd
        ss -ltn | grep -q ':22 '
        ss -ltn | grep -q ':2222 '
        ss -ltn | grep -q ':${sshPort} '
        ss -ltn | grep -q ':${sftpPort} '
    `)}`);
}

async function getDashboardText() {
    const stats = await getSystemStats();
    const vpsList = db.getAllVPS();
    const activeVPS = vpsList.filter(v => v.status === "running").length;
    const uptime = getUptime();

    return `<b>☁️ MAIN DASHBOARD</b>\n` +
           `━━━━━━━━━━━━━━━━━━━━\n` +
           `🤖 <b>Sistem Uptime:</b> <code>${uptime}</code>\n` +
           `🖥️ <b>CPU Load:</b> <code>${stats.cpu}%</code>\n` +
           `💾 <b>RAM Usage:</b> <code>${stats.usedRam}GB / ${stats.totalRam}GB (${stats.ram}%)</code>\n` +
           `💿 <b>Disk Usage:</b> <code>${stats.usedDisk} / ${stats.totalDisk} (${stats.disk}%)</code>\n` +
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
        session.state = "choose_ram";

        let text = `<b>💾 PILIH MEMORY / RAM VPS</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
        RAM_OPTIONS.forEach((ram, idx) => {
            text += `${idx + 1}. <b>${ram.name}</b> (<code>${ram.detail}</code>)\n`;
        });
        text += `━━━━━━━━━━━━━━━━━━━━\n`;
        text += `💿 <b>OS Terpilih:</b> <code>${os.name}</code>\n`;
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
            Markup.button.callback("↩️ Back (Pilih OS)", "create_vps"),
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

        let text = `<b>💿 PILIH KAPASITAS DISK VPS</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
        DISK_OPTIONS.forEach((disk, idx) => {
            text += `${idx + 1}. <b>${disk.name} SSD Storage</b>\n`;
        });
        text += `━━━━━━━━━━━━━━━━━━━━\n`;
        text += `💿 <b>OS Terpilih:</b> <code>${osData.name}</code>\n`;
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
            Markup.button.callback("↩️ Back (Pilih RAM)", `set_os_${OS_OPTIONS.findIndex(o => o.key === session.selectedOS)}`),
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
        const ramData = RAM_OPTIONS.find(rm => rm.name === session.selectedRAM);

        let text = `<b>⚡ PILIH CORE CPU VPS</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
        CPU_OPTIONS.forEach((cpu, idx) => {
            text += `${idx + 1}. <b>${cpu.name} Processor</b>\n`;
        });
        text += `━━━━━━━━━━━━━━━━━━━━\n`;
        text += `💿 <b>OS Terpilih:</b> <code>${osData.name}</code>\n`;
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
        const ramData = RAM_OPTIONS.find(rm => rm.name === session.selectedRAM);

        let text = `<b>⚠️ KONFIRMASI PEMBUATAN VPS</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
                   `💿 <b>Sistem Operasi:</b> <code>${osData.emoji} ${osData.name}</code>\n` +
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

    await ctx.editMessageCaption(
        `<b>⏳ SEDANG MEMBANGUN VPS...</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
        `💿 <b>OS:</b> <code>${osData.name}</code>\n` +
        `💾 <b>RAM:</b> <code>${session.selectedRAM}</code>\n` +
        `💿 <b>Disk:</b> <code>${session.selectedDisk}</code>\n` +
        `⚡ <b>CPU:</b> <code>${session.selectedCPU}</code>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `<i>Sistem sedang menyiapkan container docker, menghasilkan port acak baru, dan menginstalasi modul pendukung. Harap tunggu sebentar...</i>`,
        { parse_mode: "HTML" }
    );

    try {
        const sshPort = await generateValidPort();
        const sftpPort = await generateValidPort();
        const password = generateRandomPassword();
        await getPublicIP();

        const vps = await db.createVPS(
            session.selectedOS,
            session.selectedRAM,
            session.selectedDisk,
            session.selectedCPU,
            sshPort,
            sftpPort,
            password,
            HOST_PUBLIC_IP
        );

        await openHostVPSPorts(sshPort, sftpPort);

        const cmd = `docker run -d --name vps_${vps.id} -p 0.0.0.0:${sshPort}:${sshPort} -p 0.0.0.0:${sftpPort}:${sftpPort} --privileged ${osData.image} tail -f /dev/null`;
        const { stdout } = await execPromise(cmd);
        vps.containerId = stdout.trim();
        vps.status = "running";
        await db.save();

        await configureSSHAndSFTP(vps.containerId, password, sshPort, sftpPort);
        const sshCommand = await startTmateSession(vps.containerId);

        if (sshCommand) {
            vps.sshCommand = sshCommand;
            await db.save();

            let successText = `<b>✅ VPS BERHASIL DIDEPLOY!</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
                              `🆔 <b>ID VPS:</b> <code>${vps.id}</code>\n` +
                              `💿 <b>OS:</b> <code>${osData.emoji} ${osData.name}</code>\n` +
                              `💾 <b>RAM:</b> <code>${session.selectedRAM}</code>\n` +
                              `💿 <b>Disk:</b> <code>${session.selectedDisk}</code>\n` +
                              `⚡ <b>CPU:</b> <code>${session.selectedCPU}</code>\n` +
                              `🟢 <b>Status:</b> <code>Running</code>\n` +
                              `━━━━━━━━━━━━━━━━━━━━\n` +
                              `🔑 <b>METODE 1: SSH (Tmate Command):</b>\n<code>${sshCommand}</code>\n\n` +
                              `🌐 <b>METODE 2: DIRECT IP VPS:</b>\n` +
                              `🖥️ <b>IP Host:</b> <code>${HOST_PUBLIC_IP}</code>\n` +
                              `🔌 <b>Port SSH:</b> <code>${sshPort}</code>\n` +
                              `📂 <b>Port SFTP:</b> <code>${sftpPort}</code>\n` +
                              `👤 <b>Username:</b> <code>root</code>\n` +
                              `🔑 <b>Password:</b> <code>${password}</code>\n` +
                              `━━━━━━━━━━━━━━━━━━━━\n` +
                              `<i>Gunakan salah satu metode di atas untuk mengakses VPS Anda sekarang.</i>`;

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
                `Namun, Anda masih bisa login via Direct IP VPS.\n\n` +
                `🆔 <b>ID VPS:</b> <code>${vps.id}</code>\n` +
                `🖥️ <b>IP Host:</b> <code>${HOST_PUBLIC_IP}</code>\n` +
                `🔌 <b>Port SSH:</b> <code>${sshPort}</code>\n` +
                `📂 <b>Port SFTP:</b> <code>${sftpPort}</code>\n` +
                `👤 <b>Username:</b> <code>root</code>\n` +
                `🔑 <b>Password:</b> <code>${password}</code>`,
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
                `   └ 🌐 IP Host: <code>${vps.ipAddress || HOST_PUBLIC_IP}</code>\n\n`;
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
    if (vps.containerId && vps.status === "running") {
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

    await getPublicIP();
    if (vps.sshPort && vps.sftpPort) {
        await openHostVPSPorts(vps.sshPort, vps.sftpPort);
    }

    let text = `<b>🛠️ KELOLA VPS: <code>${vps.id}</code></b>\n` +
               `━━━━━━━━━━━━━━━━━━━━\n` +
               `🟢 <b>Status Server:</b> <code>${statusText}</code>\n` +
               `💿 <b>OS Variant:</b> <code>${vps.osEmoji} ${vps.osName}</code>\n` +
               `💾 <b>Alokasi RAM:</b> <code>${vps.ram || "2GB"}</code>\n` +
               `💿 <b>Kapasitas Disk:</b> <code>${vps.disk || "64GB"}</code>\n` +
               `⚡ <b>Inti Processor:</b> <code>${vps.cpu || "1 Core"}</code>\n` +
               `📅 <b>Dibuat Pada:</b> <code>${createdDate}</code>\n` +
               `━━━━━━━━━━━━━━━━━━━━\n` +
               `📊 <b>MONITORING CONTAINER VPS</b>\n` +
               `├ <b>CPU Core Usage:</b> <code>${dockerStats.cpu}</code>\n` +
               `└ <b>RAM Virtual Usage:</b> <code>${dockerStats.memory} (${dockerStats.memPercent})</code>\n` +
               `━━━━━━━━━━━━━━━━━━━━\n` +
               `🔑 <b>METODE 1: SSH (Tmate Command):</b>\n` +
               `<code>${vps.sshCommand || "Belum Dibuat / Regenerasikan"}</code>\n\n` +
               `🌐 <b>METODE 2: DIRECT IP VPS:</b>\n` +
               `🖥️ <b>IP Host:</b> <code>${vps.ipAddress || HOST_PUBLIC_IP}</code>\n` +
               `🔌 <b>Port SSH:</b> <code>${vps.sshPort || "N/A"}</code>\n` +
               `📂 <b>Port SFTP:</b> <code>${vps.sftpPort || "N/A"}</code>\n` +
               `👤 <b>Username:</b> <code>root</code>\n` +
               `🔑 <b>Password:</b> <code>${vps.password || "N/A"}</code>\n` +
               `━━━━━━━━━━━━━━━━━━━━\n` +
               `<i>Update real-time resource VPS Anda dengan menekan tombol refresh.</i>`;

    const buttons = [
        [
            Markup.button.callback("🔄 Refresh Info", `refresh_vps_${vps.id}`),
            Markup.button.callback("🌀 Reboot VPS", `reboot_vps_${vps.id}`)
        ],
        [
            Markup.button.callback("🔑 Regen SSH", `regen_ssh_${vps.id}`),
            Markup.button.callback("🗑️ Hapus VPS", `confirm_delete_vps_${vps.id}`)
        ],
        [
            Markup.button.callback("↩️ Kembali ke List", "list_vps")
        ]
    ];

    await ctx.editMessageCaption(text, {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard(buttons)
    });
}

bot.action(/^refresh_vps_(.+)$/, async (ctx) => {
    const vpsId = ctx.match[1];
    await ctx.answerCbQuery("Status Kontainer Diperbarui!");
    await renderVPSManagement(ctx, vpsId, true);
});

bot.action(/^reboot_vps_(.+)$/, async (ctx) => {
    const vpsId = ctx.match[1];
    await ctx.answerCbQuery("Sedang me-reboot VPS...");
    const vps = db.getVPS(vpsId);

    if (!vps || !vps.containerId) {
        return ctx.reply("❌ Kontainer tidak valid.");
    }

    await ctx.editMessageCaption(
        `<b>🌀 SEDANG ME-REBOOT VPS...</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
        `🆔 <b>ID VPS:</b> <code>${vps.id}</code>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `<i>Sedang melakukan restart aman pada container Docker, mengkonfigurasi ulang SSH, dan mengaktifkan sesi Tmate baru. Harap tunggu...</i>`,
        { parse_mode: "HTML" }
    );

    try {
        await execPromise(`docker restart ${vps.containerId}`);
        await openHostVPSPorts(vps.sshPort, vps.sftpPort);
        await configureSSHAndSFTP(vps.containerId, vps.password, vps.sshPort, vps.sftpPort);
        const sshCommand = await startTmateSession(vps.containerId);
        if (sshCommand) {
            vps.sshCommand = sshCommand;
            await db.save();
        }
        await new Promise(resolve => setTimeout(resolve, 1500));
        await renderVPSManagement(ctx, vpsId);
    } catch (err) {
        await ctx.editMessageCaption(
            `<b>❌ GAGAL REBOOT VPS</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
            `<code>${err.message}</code>`,
            {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([[Markup.button.callback("↩️ Kembali ke Panel VPS", `manage_vps_${vps.id}`)]])
            }
        );
    }
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
                await closeHostVPSPorts(vps.sshPort, vps.sftpPort);
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
    await getPublicIP();
    
    await bot.launch();
    console.log("🚀 JKSoft-VpsFree (Owner Version) Berhasil dijalankan!");
})();

process.once("SIGINT", () => {
    bot.stop("SIGINT");
});
process.once("SIGTERM", () => {
    bot.stop("SIGTERM");
});
