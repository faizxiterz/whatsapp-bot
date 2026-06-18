// ============================================================
// WHATSAPP BOT - VERSI SIMPLE TAPI LENGKAP
// Fitur: Rekap Game, Cek Saldo, History, Reset, Sewa Bot
// ============================================================

const { Client, LocalAuth } = require('whatsapp-web.js');

// ============================================================
// KONFIGURASI
// ============================================================

// GANTI DENGAN NOMOR WHATSAPP KAMU!
const OWNER_USER_ID = '6282261298503@c.us'; // <-- GANTI INI!

// ============================================================
// DATA STORAGE (Pake Map, gak pake SQL biar ringan)
// ============================================================

const game_data = new Map();        // nyimpen data game
const rekap_data = new Map();       // nyimpen data rekap sementara
const rekapwin_owner = new Map();   // nyimpen siapa yang lagi rekap
const sewabot_map = new Map();      // nyimpen data sewa

// ============================================================
// HELPER FUNCTIONS (SEDERHANA)
// ============================================================

function fmt_num(x) {
    return Number.isInteger(x) ? String(x) : String(x);
}

function is_owner(user_id) {
    return user_id === OWNER_USER_ID;
}

function clean_number(num) {
    const match = String(num).match(/\d+/);
    return match ? parseInt(match[0]) : 0;
}

// Fungsi fee - DISEDERHANAKAN
function calculate_fee(n, fee_percent = 6) {
    if (n <= 0) return 0;
    if (n <= 9) return 1;
    return Math.floor(n * fee_percent / 100) || 1;
}

// Fungsi proses saldo - DISEDERHANAKAN
function proses_saldo(pemain_list, fee_percent = 6, saldo_lama = {}) {
    const saldo = new Map();
    
    // Copy saldo lama
    for (const [nama, s] of Object.entries(saldo_lama)) {
        saldo.set(nama, s);
    }
    
    // Proses setiap pemain
    for (const [nama, angka] of pemain_list) {
        const match = String(angka).match(/(\d+)\s*([A-Za-z]*)/);
        if (!match) continue;
        
        const num = parseInt(match[1]);
        const huruf = match[2].toUpperCase();
        
        // Kalo P atau LF, kena fee
        if (huruf === 'P' || huruf === 'LF') {
            const nilai = num - calculate_fee(num, fee_percent);
            saldo.set(nama, (saldo.get(nama) || 0) + nilai);
        } else {
            // Kalo B, dapet double
            const nilai = (num * 2) - calculate_fee(num, fee_percent);
            saldo.set(nama, (saldo.get(nama) || 0) + nilai);
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
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// ============================================================
// FUNGSI KIRIM REKAP (SEDERHANA)
// ============================================================

async function kirim_rekap(chatId) {
    const data = rekap_data.get(chatId);
    if (!data) {
        await client.sendMessage(chatId, "⚠️ Data rekap tidak ditemukan.");
        return;
    }
    rekap_data.delete(chatId);
    
    const { game_id, win, scor, k, b, fee = 6 } = data;
    const sisi_menang = win === "K" ? k : b;
    
    const gameData = game_data.get(chatId) || { 
        games: [], 
        dev: "", 
        rol: "", 
        last_win: "", 
        saldo: {}, 
        total_fee: 0 
    };
    
    const saldo_baru = proses_saldo(sisi_menang, fee, gameData.saldo);
    gameData.saldo = saldo_baru;
    gameData.last_win = win;
    gameData.games.push(`Game ${game_id}: ${win} ${scor}`);
    game_data.set(chatId, gameData);
    
    let msg = `╔══════════════════════╗\n`;
    msg += `║   📊 REKAP GAME ${game_id}   ║\n`;
    msg += `╚══════════════════════╝\n\n`;
    msg += `🏆 Pemenang: ${win === "K" ? "KECIL" : "BESAR"}\n`;
    msg += `📝 Skor: ${scor}\n\n`;
    if (gameData.dev) msg += `💻 DEV: ${gameData.dev}\n`;
    if (gameData.rol) msg += `🌐 ROL: ${gameData.rol}\n`;
    msg += `\n📋 SALDO:\n`;
    for (const [nama, saldo] of Object.entries(saldo_baru)) {
        if (saldo !== 0) msg += `   ${nama}: ${saldo}\n`;
    }
    
    await client.sendMessage(chatId, msg);
    rekapwin_owner.delete(chatId);
}

// ============================================================
// MESSAGE HANDLER (SEMUA FITUR TETAP ADA)
// ============================================================

client.on('message', async (message) => {
    if (!message.body || message.isStatus) return;
    
    const body = message.body.toLowerCase();
    const chatId = message.from;
    const userId = message.author || message.from;

    // ========== 1. REKAP WIN ==========
    if (body === '/rekapwin' || body.startsWith('/rekapwin ')) {
        // Cek sewa
        if (!is_sewa_aktif(chatId) && !is_owner(userId)) {
            await client.sendMessage(chatId, "⚠️ Grup belum aktif sewa. Ketik /sewabot");
            return;
        }
        
        const parts = message.body.split(' ');
        if (parts.length < 2) {
            await client.sendMessage(chatId, "⚠️ Wajib sertakan fee. Contoh: /rekapwin 6");
            return;
        }
        
        const fee_custom = parseFloat(parts[1]) || 6;
        
        if (!message.hasQuotedMsg) {
            await client.sendMessage(chatId, "⚠️ Balas pesan yang berisi data duel.");
            return;
        }
        
        const quotedMsg = await message.getQuotedMessage();
        const isi = quotedMsg.body.toUpperCase();
        
        const kecilMatch = isi.match(/K[ECIL]*\s*:(.*?)(?=B[ESAR]*\s*:|$)/s);
        const besarMatch = isi.match(/B[ESAR]*\s*:(.*?)(?=K[ECIL]*\s*:|$)/s);
        
        if (!kecilMatch || !besarMatch) {
            await client.sendMessage(chatId, "⚠️ Format salah. Harus ada K: dan B:.");
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
        
        await client.sendMessage(chatId, 
            `📊 *REKAP GAME ${game_id}*\n\n` +
            `Pilih pemenang:\n` +
            `1️⃣ KECIL\n` +
            `2️⃣ BESAR\n\n` +
            `Balas dengan angka 1 atau 2`
        );
        return;
    }

    // ========== HANDLE RESPONSES ==========
    if (message.hasQuotedMsg) {
        const data = rekap_data.get(chatId);
        if (!data) return;
        
        // Cek apakah user yang sama
        if (data.user_id !== userId && !is_owner(userId)) {
            await client.sendMessage(chatId, "⚠️ Hanya user yang memulai rekap yang bisa melanjutkan.");
            return;
        }
        
        // STEP 1: Pilih pemenang
        if (data.step === 'waiting_win') {
            const selection = message.body.trim();
            if (selection === '1' || selection === '2') {
                data.win = selection === '1' ? 'K' : 'B';
                data.step = 'waiting_scor';
                await client.sendMessage(chatId, 
                    `Pilih skor:\n` +
                    `1️⃣ 2-0\n` +
                    `2️⃣ 2-1\n\n` +
                    `Balas dengan angka 1 atau 2`
                );
                rekap_data.set(chatId, data);
            }
            return;
        }
        
        // STEP 2: Pilih skor
        if (data.step === 'waiting_scor') {
            const selection = message.body.trim();
            if (selection === '1' || selection === '2') {
                data.scor = selection === '1' ? '2-0' : '2-1';
                data.step = 'waiting_rol';
                await client.sendMessage(chatId, 
                    `Pilih browser:\n` +
                    `1️⃣ SAFARI\n` +
                    `2️⃣ GOOGLE\n` +
                    `3️⃣ CHROME\n\n` +
                    `Balas dengan angka 1, 2, atau 3`
                );
                rekap_data.set(chatId, data);
            }
            return;
        }
        
        // STEP 3: Pilih browser
        if (data.step === 'waiting_rol') {
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
            return;
        }
        
        // STEP 4: Input device
        if (data.step === 'waiting_dev') {
            const gameData = game_data.get(chatId) || {};
            gameData.dev = message.body.trim().toUpperCase();
            game_data.set(chatId, gameData);
            await kirim_rekap(chatId);
            return;
        }
    }

    // ========== CEK SALDO ==========
    if (body === '/ceksaldo') {
        const gameData = game_data.get(chatId);
        if (!gameData || !gameData.saldo || Object.keys(gameData.saldo).length === 0) {
            await client.sendMessage(chatId, "📊 Belum ada data saldo.");
            return;
        }
        
        let msg = "📊 *SALDO PEMAIN*\n\n";
        for (const [nama, saldo] of Object.entries(gameData.saldo)) {
            if (saldo !== 0) msg += `${nama}: ${saldo}\n`;
        }
        await client.sendMessage(chatId, msg);
    }

    // ========== CEK GAME ==========
    if (body === '/cekgame') {
        const gameData = game_data.get(chatId);
        if (!gameData || !gameData.games || gameData.games.length === 0) {
            await client.sendMessage(chatId, "📋 Belum ada game.");
            return;
        }
        
        let msg = "📋 *HISTORY GAME*\n\n";
        for (const game of gameData.games) {
            msg += `${game}\n`;
        }
        if (gameData.dev) msg += `\n💻 DEV: ${gameData.dev}`;
        if (gameData.rol) msg += `\n🌐 ROL: ${gameData.rol}`;
        await client.sendMessage(chatId, msg);
    }

    // ========== RESET ==========
    if (body === '/resetlw') {
        if (!is_owner(userId)) {
            await client.sendMessage(chatId, "⚠️ Hanya owner yang bisa reset.");
            return;
        }
        game_data.set(chatId, { games: [], dev: "", rol: "", saldo: {} });
        rekap_data.delete(chatId);
        rekapwin_owner.delete(chatId);
        await client.sendMessage(chatId, "✅ Data berhasil direset.");
    }

    // ========== SEWA BOT ==========
    if (body === '/sewabot' || body.startsWith('/sewabot ')) {
        if (!is_owner(userId)) {
            await client.sendMessage(chatId, "⚠️ Hanya owner yang bisa mengaktifkan sewa.");
            return;
        }
        
        const parts = message.body.split(' ');
        if (parts.length < 2) {
            await client.sendMessage(chatId, 
                `📌 Format: /sewabot [durasi]\n` +
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
        
        await client.sendMessage(chatId, 
            `✅ Sewa bot berhasil diaktifkan!\n` +
            `Durasi: ${durasi === 'permanen' ? 'Permanen' : '1 Bulan'}`
        );
    }

    // ========== HELP ==========
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
// START BOT + PAIRING CODE
// ============================================================

client.on('ready', () => {
    console.log('✅ Bot WhatsApp Aktif!');
    console.log(`📱 Nomor: ${client.info.wid.user}`);
});

console.log('🚀 Memulai bot...');
client.initialize();

setTimeout(async () => {
    try {
        const code = await client.requestPairingCode();
        console.log(`🔑 PAIRING CODE: ${code}`);
        console.log('📱 Gunakan kode ini di WhatsApp > Settings > Linked Devices');
    } catch (e) {
        console.log('⏳ Client belum siap, pairing code akan muncul nanti...');
    }
}, 30000);

console.log('🤖 Bot siap digunakan!');