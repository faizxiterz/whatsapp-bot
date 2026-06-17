// whatsapp-bot.js
const { Client, LocalAuth } = require('whatsapp-web.js');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

// ==============================
// KONFIGURASI
// ==============================

// GANTI DENGAN NOMOR WHATSAPP KAMU!
// Format: 628xxxxxxxxx@c.us
const OWNER_USER_ID = '628123456789@c.us';

// ==============================
// DATABASE
// ==============================

const DB_FILE = "allowed_groups.db";
let allowed_groups = new Set();
const game_data = new Map();
const rekap_data = new Map();
const rekapwin_owner = new Map();
const current_game_host = new Map();
const sewabot_map = new Map();

// ==============================
// HELPER FUNCTIONS
// ==============================

function fmt_num(x) {
    try {
        x = parseFloat(x);
    } catch {
        return String(x);
    }
    return Number.isInteger(x) ? String(parseInt(x)) : String(x);
}

function is_owner(user_id) {
    return user_id === OWNER_USER_ID;
}

function clean_number(num) {
    const match = String(num).match(/\d+/);
    return match ? parseInt(match[0]) : 0;
}

function calculate_fee(n, fee_percent = 6) {
    if (n <= 0) return 0;
    if (n <= 9) return 1;
    const interval_map = { 5: 10, 6: 8.3, 7: 7.2, 8: 6.3, 9: 5, 10: 4 };
    const interval = interval_map[Math.floor(fee_percent)] || 10;
    return 1 + Math.floor((n - 10) / interval) + 1;
}

function proses_saldo(pemain_list, sisi_menang, fee_percent = 6, lw_saldo = null) {
    const saldo = new Map();
    if (lw_saldo) {
        for (const [nama, s] of Object.entries(lw_saldo)) {
            saldo.set(nama, s);
        }
    }
    
    for (const [nama, angka] of pemain_list) {
        const match = String(angka).match(/(\d+)\s*([A-Za-z]*)/);
        if (!match) continue;
        const num = parseInt(match[1]);
        const huruf = match[2].toUpperCase();
        
        if (huruf === 'P' || huruf === 'LF') {
            const nilai = num - calculate_fee(num, fee_percent);
            saldo.set(nama, (saldo.get(nama) || 0) + Math.floor(nilai));
        } else {
            const nilai = (num * 2) - calculate_fee(num, fee_percent);
            saldo.set(nama, (saldo.get(nama) || 0) + Math.floor(nilai));
        }
    }
    return Object.fromEntries(saldo);
}

function parseData(lines) {
    const result = [];
    for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) {
            result.push([parts[0], parts.slice(1).join(' ')]);
        }
    }
    return result;
}

// ==============================
// WHATSAPP CLIENT
// ==============================

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage'
        ]
    }
});

// ==============================
// COMMAND HANDLERS
// ==============================

async function kirim_rekap(chatId) {
    const data = rekap_data.get(chatId);
    if (!data) {
        await client.sendMessage(chatId, "Data rekap tidak ditemukan.");
        return;
    }
    rekap_data.delete(chatId);
    
    const { game_id, win, scor, k, b, fee = 6 } = data;
    const sisi_menang = win === "K" ? k : b;
    const gameData = game_data.get(chatId) || { games: [], dev: "", rol: "", saldo: {}, total_fee: 0 };
    
    const saldo_baru = proses_saldo(sisi_menang, sisi_menang, fee, gameData.saldo);
    gameData.saldo = saldo_baru;
    gameData.games.push(`Game ${game_id}: ${win} ${scor}`);
    game_data.set(chatId, gameData);
    
    let rekapMessage = `╔══════════════════════╗\n`;
    rekapMessage += `║   📊 REKAP GAME ${game_id}   ║\n`;
    rekapMessage += `╚══════════════════════╝\n\n`;
    rekapMessage += `🏆 Pemenang: ${win === "K" ? "KECIL" : "BESAR"}\n`;
    rekapMessage += `📝 Skor: ${scor}\n\n`;
    if (gameData.dev) rekapMessage += `💻 DEV: ${gameData.dev}\n`;
    if (gameData.rol) rekapMessage += `🌐 ROL: ${gameData.rol}\n`;
    
    rekapMessage += `\n📋 SALDO:\n`;
    for (const [nama, saldo] of Object.entries(saldo_baru)) {
        if (saldo !== 0) {
            rekapMessage += `   ${nama}: ${fmt_num(saldo)}\n`;
        }
    }
    
    await client.sendMessage(chatId, rekapMessage);
    rekapwin_owner.delete(chatId);
}

// ==============================
// MESSAGE HANDLER
// ==============================

client.on('message', async (message) => {
    if (!message.body || message.isStatus) return;
    
    const body = message.body.toLowerCase();
    const chatId = message.from;
    const userId = message.author || message.from;

    // Command: /rekapwin
    if (body === '/rekapwin' || body.startsWith('/rekapwin ')) {
        const parts = message.body.split(' ');
        if (parts.length < 2) {
            await client.sendMessage(chatId, "Wajib sertakan fee. Contoh: /rekapwin 6");
            return;
        }
        
        let fee_custom;
        try {
            fee_custom = parseFloat(parts[1]);
        } catch {
            await client.sendMessage(chatId, "Fee harus angka");
            return;
        }
        
        if (!message.hasQuotedMsg) {
            await client.sendMessage(chatId, "Mohon balas pesan yang berisi data duel.");
            return;
        }
        
        const quotedMsg = await message.getQuotedMessage();
        const isi = quotedMsg.body.toUpperCase();
        
        const kecilMatch = isi.match(/K[ECIL]*\s*:(.*?)(?=B[ESAR]*\s*:|$)/s);
        const besarMatch = isi.match(/B[ESAR]*\s*:(.*?)(?=K[ECIL]*\s*:|$)/s);
        
        if (!kecilMatch || !besarMatch) {
            await client.sendMessage(chatId, "Format salah. Harus ada K: dan B:.");
            return;
        }
        
        const k_players = parseData(kecilMatch[1].trim().split('\n'));
        const b_players = parseData(besarMatch[1].trim().split('\n'));
        
        const gameData = game_data.get(chatId) || { games: [], dev: "", rol: "", saldo: {} };
        const game_id = gameData.games.length + 1;
        game_data.set(chatId, gameData);
        
        rekap_data.set(chatId, {
            game_id,
            k: k_players,
            b: b_players,
            fee: fee_custom,
            user_id: userId,
            step: 'waiting_win'
        });
        rekapwin_owner.set(chatId, userId);
        current_game_host.set(chatId, userId);
        
        await client.sendMessage(chatId, 
            `📊 *REKAP GAME ${game_id}*\n\n` +
            `Pilih tim pemenang:\n` +
            `1️⃣ KECIL\n` +
            `2️⃣ BESAR\n\n` +
            `Balas pesan ini dengan angka 1 atau 2.`
        );
        return;
    }

    // Handle responses
    if (message.hasQuotedMsg) {
        const data = rekap_data.get(chatId);
        if (!data) return;
        
        if (data.step === 'waiting_win') {
            const selection = message.body.trim();
            if (selection === '1' || selection === '2') {
                data.win = selection === '1' ? 'K' : 'B';
                data.step = 'waiting_scor';
                await client.sendMessage(chatId, 
                    `Pilih skor:\n` +
                    `1️⃣ 2-0\n` +
                    `2️⃣ 2-1\n\n` +
                    `Balas pesan ini dengan angka 1 atau 2.`
                );
                rekap_data.set(chatId, data);
            }
        } else if (data.step === 'waiting_scor') {
            const selection = message.body.trim();
            if (selection === '1' || selection === '2') {
                data.scor = selection === '1' ? '2-0' : '2-1';
                data.step = 'waiting_dev';
                await client.sendMessage(chatId, `Masukkan nama device (balas pesan ini):`);
                rekap_data.set(chatId, data);
            }
        } else if (data.step === 'waiting_dev') {
            const gameData = game_data.get(chatId) || {};
            gameData.dev = message.body.trim().toUpperCase();
            game_data.set(chatId, gameData);
            await kirim_rekap(chatId);
        }
    }

    // Command: /ceksaldo
    if (body === '/ceksaldo') {
        const gameData = game_data.get(chatId);
        if (!gameData || !gameData.saldo || Object.keys(gameData.saldo).length === 0) {
            await client.sendMessage(chatId, "Belum ada data saldo.");
            return;
        }
        
        let saldoMsg = "📊 *SALDO PEMAIN*\n\n";
        for (const [nama, saldo] of Object.entries(gameData.saldo)) {
            saldoMsg += `${nama}: ${fmt_num(saldo)}\n`;
        }
        await client.sendMessage(chatId, saldoMsg);
    }

    // Command: /cekgame
    if (body === '/cekgame') {
        const gameData = game_data.get(chatId);
        if (!gameData || !gameData.games || gameData.games.length === 0) {
            await client.sendMessage(chatId, "Belum ada game.");
            return;
        }
        
        let gameMsg = "📋 *HISTORY GAME*\n\n";
        for (const game of gameData.games) {
            gameMsg += `${game}\n`;
        }
        await client.sendMessage(chatId, gameMsg);
    }

    // Command: /resetlw
    if (body === '/resetlw') {
        game_data.set(chatId, { games: [], dev: "", rol: "", saldo: {} });
        rekap_data.delete(chatId);
        rekapwin_owner.delete(chatId);
        await client.sendMessage(chatId, "✅ Data berhasil direset.");
    }

    // Command: /sewabot (owner only)
    if (body === '/sewabot' || body.startsWith('/sewabot ')) {
        if (!is_owner(userId)) {
            await client.sendMessage(chatId, "Hanya owner yang bisa mengaktifkan sewa.");
            return;
        }
        
        const parts = message.body.split(' ');
        if (parts.length < 2) {
            await client.sendMessage(chatId, `Format: /sewabot [durasi]\nContoh: /sewabot 1bulan`);
            return;
        }
        
        const durasi = parts[1].toLowerCase();
        save_group(chatId);
        allowed_groups.add(chatId);
        
        await client.sendMessage(chatId, 
            `✅ Sewa bot berhasil diaktifkan!\nDurasi: ${durasi === 'permanen' ? 'Permanen' : '1 Bulan'}`
        );
    }
});

// ==============================
// START BOT
// ==============================

function save_group(chat_id) {
    // Simple save implementation
}

client.on('ready', () => {
    console.log('✅ Bot WhatsApp Aktif!');
    console.log(`📱 Nomor: ${client.info.wid.user}`);
});

client.on('auth_failure', (msg) => {
    console.error('❌ Autentikasi gagal:', msg);
});

client.on('disconnected', (reason) => {
    console.log('❌ Bot terputus:', reason);
});

console.log('🔄 Memulai bot WhatsApp...');
client.initialize();

// Generate pairing code
setTimeout(async () => {
    try {
        const code = await client.requestPairingCode();
        console.log(`🔑 PAIRING CODE: ${code}`);
        console.log('📱 Gunakan kode ini di WhatsApp > Settings > Linked Devices');
    } catch (error) {
        console.log('⚠️ Tunggu beberapa saat, pairing code akan muncul...');
    }
}, 5000);

console.log('🤖 Bot siap digunakan!');