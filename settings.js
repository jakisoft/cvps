module.exports = {
    token: process.env.BOT_TOKEN || "8640346901:AAEjNtLYejnHnfocKNalcV1P2jqnbN4eTrc",
    brandName: "Skynx Cloud System",
    provider: "☁️ Skynx Cloud System",
    owner: "7285215691",
    admins: ["7285215691"],
    logsChannel: -1003207479119,
    verification: {
        enabled: true,
        requireChannelJoin: false,
        channel: "@",
        requireContact: true
    },
    prices: {
        premiumIdr: 5000,
        createVpsCost: 7,
        extendCost: 10,
        dailyReward: 3,
        referralBonus: 3,
        referralBonusIncrease: 3
    },
    durations: {
        freeVpsMs: 15 * 60 * 1000,
        extendMs: 15 * 60 * 1000,
        dailyCooldownMs: 24 * 60 * 60 * 1000
    },
    videoLink: "https://drive.google.com/file/d/196OI5SXLmt8hSOnH-07LXANo3ZVNfuhQ/view?usp=drivesdk"
};
