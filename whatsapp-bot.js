// ============================================================
// WHATSAPP BOT - LENGKAP 1 FILE (FIXED PAIRING CODE)
// Fitur: Rekap Game, Cek Saldo, History, Reset, Sewa Bot
// ============================================================

const { Client, LocalAuth } = require('whatsapp-web.js');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

// ============================================================
// KONFIGURASI
// ============================================================

// GANTI DENGAN NOMOR WHATSAPP KAMU!
// Format: 628xxxxxxxxx@c.us (62 = kode Indonesia)
const OWNER_USER_ID = '6282261298503@c.us'; // <-- GANTI INI!

// ============================================================
// DATABASE
// ============================================================

const DB_FILE = "allowed_groups.db";
let allowed_groups = new Set();
const game_data = new Map();
const rekap_data = new Map();
const rekapwin_owner = new Map();
const current_game_host = new Map();
const sewabot_map = new Map();
const reset_mode_active = new Map();

function init_db() {
    const db = new sqlite3.Database(DB_FILE);
    db.run("CREATE TABLE IF NOT EXISTS allowed_groups (chat_id TEXT PRIMARY KEY)");
    db.close();
}
init_db();

function save_group(chat_id) {
    const db = new sqlite3.Database(DB_FILE);
    db.run("INSERT OR IGNORE INTO allowed_groups (chat_id) VALUES (?)", [chat_id]);
    db.close();
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

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

function calculate_fee(n, fee_percent = 6, is_double = false) {
    if (n <= 0) return 0;
    if (n <= 9) return 1;
    const interval_map = { 5: 10, 6: 8.3, 7: 7.2, 8: 6.3, 9: 5, 10: 4 };
    const interval = interval_map[Math.floor(fee_percent)] || 10;
    return 1 + Math.floor((n - 10) / interval) + 1;
}

function proses_saldo(pemain_list, sisi_menang, sisi_kalah, menang = true, fee_percent = 6, lw_saldo = null) {
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
        
        if (menang) {
            if (huruf === 'P' || huruf === 'LF') {
                const nilai = num - calculate_fee(num, fee_percent, false);
                saldo.set(nama, (saldo.get(nama) || 0) + Math.floor(nilai));
            } else {
                const nilai = (num * 2) - calculate_fee(num, fee_percent, true);
                saldo.set(nama, (saldo.get(nama) || 0) + Math.floor(nilai));
            }
        } else {
            if (huruf === 'P' || huruf === 'LF') {
                saldo.set(nama, (saldo.get(nama) || 0) - num);
            } else {
                if (lw_saldo && lw_saldo[nama] > 0) {
                    saldo.set(nama, (saldo.get(nama) || 0) - num);
                }
            }
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

function is_sewa_aktif(chat_id) {
    if (!sewabot_map.has(chat_id)) return false;
    const data = sewabot_map.get(chat_id);
    if (data.paket === "permanen") return true;
    if (data.paket === "1bulan" && data.expire) {
        return data.expire > Math.floor(Date.now() / 1000);
    }
    return false;
}

// ============================================================
// WHATSAPP CLIENT
// ============================================================

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        executablePath: '/usr/bin/google-chrome-stable',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-size=1920x1080'
        ]
    }
});

// ============================================================
// KIRIM REKAP
// ============================================================

async function kirim_rekap(chatId) {
    const data = rekap_data.get(chatId);
    if (!data) {
        await client.sendMessage(chatId, "Data rekap tidak ditemukan.");
        rekapwin_owner.delete(chatId);
        return;
    }
    rekap_data.delete(chatId);
    
    const { game_id, win, scor, k, b, fee = 6 } = data;
    const sisi_menang = win === "K" ? k : b;
    const sisi_kalah = win === "K" ? b : k;
    
    let total_fee_game = 0;
    for (const [nama, angka] of sisi_menang) {
        const match = String(angka).match(/(\d+)\s*([A-Za-z]*)/);
        if (!match) continue;
        const num = parseInt(match[1]);
        const huruf = match[2].toUpperCase();
        if (huruf === "P" || huruf === "LF") {
            total_fee_game += calculate_fee(num, fee, false);
        } else {
            total_fee_game += calculate_fee(num, fee, true);
        }
    }
    
    const gameData = game_data.get(chatId) || {
        games: [],
        dev: "",
        rol: "",
        last_win: "",
        saldo: {},
        history: [],
        total_fee: 0,
        total_bl: 0
    };
    
    gameData.total_fee = (gameData.total_fee || 0) + total_fee_game;
    
    const saldo_baru = proses_saldo(
        sisi_menang,
        sisi_menang,
        sisi_kalah,
        true,
        fee,
        gameData.saldo
    );
    
    gameData.saldo = saldo_baru;
    gameData.last_win = win;
    gameData.games.push(`Game ${game_id}: ${win} ${scor}`);
    gameData.history.push({
        prev_games: [...gameData.games],
        prev_saldo: {...gameData.saldo}
    });
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
    rekapMessage += `\n📊 Total Fee: ${fmt_num(gameData.total_fee)}`;
    
    await client.sendMessage(chatId, rekapMessage);
    rekapwin_owner.delete(chatId);
}

// ============================================================
// MESSAGE HANDLER
// ============================================================

client.on('message', async (message) => {
    if (!message.body || message.isStatus) return;
    
    const body = message.body.toLowerCase();
    const chatId = message.from;
    const userId = message.author || message.from;

    // ============================================================
    // COMMAND: /rekapwin
    // ============================================================
    if (body === '/rekapwin' || body.startsWith('/rekapwin ')) {
        // Cek sewa
        if (!allowed_groups.has(chatId) && !is_sewa_aktif(chatId) && !is_owner(userId)) {
            await client.sendMessage(chatId, "Grup belum aktif sewa. Ketik /sewabot");
            return;
        }
        
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
        
        const gameData = game_data.get(chatId) || {
            games: [],
            dev: "",
            rol: "",
            last_win: "",
            saldo: {},
            history: [],
            total_fee: 0,
            total_bl: 0
        };
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

    // ============================================================
    // HANDLE RESPONSES (Win, Scor, Rol, Dev)
    // ============================================================
    if (message.hasQuotedMsg) {
        const data = rekap_data.get(chatId);
        if (!data) return;
        
        // Cek apakah user yang sama
        if (data.user_id !== userId && !is_owner(userId)) {
            await client.sendMessage(chatId, "Hanya user yang memulai rekap yang bisa melanjutkan.");
            return;
        }
        
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
                
                const gameData = game_data.get(chatId) || {};
                if (!gameData.rol) {
                    data.step = 'waiting_rol';
                    await client.sendMessage(chatId, 
                        `Pilih browser:\n` +
                        `1️⃣ SAFARI\n` +
                        `2️⃣ GOOGLE\n` +
                        `3️⃣ CHROME\n\n` +
                        `Balas pesan ini dengan angka 1, 2, atau 3.`
                    );
                    rekap_data.set(chatId, data);
                } else {
                    data.step = 'waiting_dev';
                    await client.sendMessage(chatId, `Masukkan nama device (balas pesan ini):`);
                    rekap_data.set(chatId, data);
                }
            }
        } else if (data.step === 'waiting_rol') {
            const selection = message.body.trim();
            const rolMap = {'1': 'SAFARI', '2': 'GOOGLE', '3': 'CHROME'};
            if (rolMap[selection]) {
                const gameData = game_data.get(chatId) || {};
                gameData.rol = rolMap[selection];
                game_data.set(chatId, gameData);
                
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

    // ============================================================
    // COMMAND: /ceksaldo
    // ============================================================
    if (body === '/ceksaldo') {
        const gameData = game_data.get(chatId);
        if (!gameData || !gameData.saldo || Object.keys(gameData.saldo).length === 0) {
            await client.sendMessage(chatId, "Belum ada data saldo.");
            return;
        }
        
        let saldoMsg = "📊 *SALDO PEMAIN*\n\n";
        for (const [nama, saldo] of Object.entries(gameData.saldo)) {
            if (saldo !== 0) {
                saldoMsg += `${nama}: ${fmt_num(saldo)}\n`;
            }
        }
        await client.sendMessage(chatId, saldoMsg);
    }

    // ============================================================
    // COMMAND: /cekgame
    // ============================================================
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
        if (gameData.dev) gameMsg += `\n💻 DEV: ${gameData.dev}`;
        if (gameData.rol) gameMsg += `\n🌐 ROL: ${gameData.rol}`;
        gameMsg += `\n🏆 Last Win: ${gameData.last_win || '-'}`;
        gameMsg += `\n💰 Total Fee: ${fmt_num(gameData.total_fee || 0)}`;
        await client.sendMessage(chatId, gameMsg);
    }

    // ============================================================
    // COMMAND: /resetlw
    // ============================================================
    if (body === '/resetlw') {
        if (!is_owner(userId)) {
            // Cek apakah admin
            try {
                const chat = await client.getChatById(chatId);
                const participants = await chat.getParticipants();
                const isAdmin = participants.some(p => 
                    p.id._serialized === userId && (p.isAdmin || p.isSuperAdmin)
                );
                if (!isAdmin) {
                    await client.sendMessage(chatId, "Hanya admin atau owner yang bisa reset.");
                    return;
                }
            } catch {
                await client.sendMessage(chatId, "Gagal cek admin.");
                return;
            }
        }
        
        game_data.set(chatId, {
            games: [],
            dev: "",
            rol: "",
            last_win: "",
            saldo: {},
            history: [],
            total_fee: 0,
            total_bl: 0
        });
        rekap_data.delete(chatId);
        rekapwin_owner.delete(chatId);
        current_game_host.delete(chatId);
        await client.sendMessage(chatId, "✅ Data berhasil direset.");
    }

    // ============================================================
    // COMMAND: /sewabot (Owner Only)
    // ============================================================
    if (body === '/sewabot' || body.startsWith('/sewabot ')) {
        if (!is_owner(userId)) {
            await client.sendMessage(chatId, "Hanya owner yang bisa mengaktifkan sewa.");
            return;
        }
        
        const parts = message.body.split(' ');
        if (parts.length < 2) {
            await client.sendMessage(chatId, 
                `Format: /sewabot [durasi]\n` +
                `Contoh: /sewabot 1bulan\n` +
                `Atau: /sewabot permanen`
            );
            return;
        }
        
        const durasi = parts[1].toLowerCase();
        const expire = durasi === 'permanen' ? null : Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
        
        sewabot_map.set(chatId, {
            paket: durasi === 'permanen' ? 'permanen' : '1bulan',
            expire: expire
        });
        
        save_group(chatId);
        allowed_groups.add(chatId);
        
        await client.sendMessage(chatId, 
            `✅ Sewa bot berhasil diaktifkan!\n` +
            `Durasi: ${durasi === 'permanen' ? 'Permanen' : '1 Bulan'}`
        );
    }

    // ============================================================
    // COMMAND: /help
    // ============================================================
    if (body === '/help' || body === '/start') {
        await client.sendMessage(chatId,
            `🤖 *BOT WHATSAPP - REKAP GAME*\n\n` +
            `📌 *Perintah:*\n` +
            `/rekapwin [fee] - Mulai rekap game\n` +
            `/ceksaldo - Cek saldo pemain\n` +
            `/cekgame - Lihat history game\n` +
            `/resetlw - Reset semua data\n` +
            `/sewabot [durasi] - Aktivasi sewa (owner)\n` +
            `/help - Bantuan ini\n\n` +
            `📝 *Cara Pakai:*\n` +
            `1. Ketik /rekapwin 6\n` +
            `2. Balas pesan data duel\n` +
            `3. Ikuti menu pilihan\n` +
            `4. Selesai!`
        );
    }
});

// ============================================================
// START BOT + GENERATE PAIRING CODE (FIXED)
// ============================================================

client.on('ready', () => {
    console.log('✅ Bot WhatsApp Aktif!');
    console.log(`📱 Nomor: ${client.info.wid.user}`);
});

client.on('auth_failure', (msg) => {
    console.error('❌ Auth gagal:', msg);
});

client.on('disconnected', (reason) => {
    console.log('❌ Bot terputus:', reason);
});

console.log('🔄 Memulai bot WhatsApp...');
client.initialize();

// ============================================================
// GENERATE PAIRING CODE - VERSI TERBARU
// ============================================================

// Generate pairing code dengan cara yang lebih stabil
async function generatePairingCode() {
    try {
        console.log('⏳ Sedang generate pairing code...');
        
        // Tunggu client benar-benar siap
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Generate pairing code
        const code = await client.requestPairingCode();
        
        if (code) {
            console.log(`🔑 PAIRING CODE: ${code}`);
            console.log('📱 Gunakan kode ini di WhatsApp > Settings > Linked Devices');
            console.log('📱 Kode berlaku 5 menit!');
        } else {
            console.log('❌ Pairing code kosong, coba restart...');
        }
    } catch (error) {
        console.error('❌ Gagal generate pairing code:', error.message);
        console.log('⏳ Coba restart deployment lagi...');
        console.log('📱 Atau coba metode QR code:');
        console.log('📱 Buka WhatsApp > Linked Devices > Scan QR Code');
        
        // Coba lagi setelah 10 detik
        setTimeout(generatePairingCode, 10000);
    }
}

// Jalankan pairing code setelah client siap
client.on('ready', async () => {
    console.log('✅ Bot WhatsApp Aktif!');
    console.log(`📱 Nomor: ${client.info.wid.user}`);
    
    // Generate pairing code setelah ready
    await generatePairingCode();
});

// Backup: generate pairing code setelah 30 detik
setTimeout(async () => {
    try {
        if (!client.info) {
            console.log('⏳ Client belum siap, mencoba lagi...');
            return;
        }
        await generatePairingCode();
    } catch (error) {
        console.log('⏳ Client belum siap, pairing code akan muncul nanti...');
    }
}, 30000);