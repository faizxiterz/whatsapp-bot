// WHATSAPP BOT - VERSI RENDER (PASTI JALAN)
const { Client, LocalAuth } = require('whatsapp-web.js');

const OWNER_USER_ID = '6282261298503@c.us'; // GANTI NOMOR KAMU!

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        executablePath: '/usr/bin/google-chrome-stable',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

const game_data = new Map();
const rekap_data = new Map();
const sewabot_map = new Map();

function is_owner(user_id) { return user_id === OWNER_USER_ID; }
function parseData(lines) {
    const result = [];
    for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) result.push([parts[0], parts.slice(1).join(' ')]);
    }
    return result;
}
function calculate_fee(n) { return n <= 9 ? 1 : Math.floor(n * 0.06) || 1; }

function proses_saldo(pemain_list, fee = 6, saldo_lama = {}) {
    const saldo = new Map(Object.entries(saldo_lama));
    for (const [nama, angka] of pemain_list) {
        const match = String(angka).match(/(\d+)\s*([A-Za-z]*)/);
        if (!match) continue;
        const num = parseInt(match[1]);
        const huruf = match[2].toUpperCase();
        const nilai = (huruf === 'P' || huruf === 'LF') ? 
            num - calculate_fee(num) : (num * 2) - calculate_fee(num);
        saldo.set(nama, (saldo.get(nama) || 0) + nilai);
    }
    return Object.fromEntries(saldo);
}

async function kirim_rekap(chatId) {
    const data = rekap_data.get(chatId);
    if (!data) { await client.sendMessage(chatId, "Data hilang."); return; }
    rekap_data.delete(chatId);
    const { game_id, win, scor, k, b, fee } = data;
    const menang = win === 'K' ? k : b;
    const gd = game_data.get(chatId) || { games: [], dev: '', rol: '', saldo: {} };
    gd.saldo = proses_saldo(menang, fee, gd.saldo);
    gd.games.push(`Game ${game_id}: ${win} ${scor}`);
    game_data.set(chatId, gd);
    let msg = `📊 REKAP GAME ${game_id}\n🏆 ${win === 'K' ? 'KECIL' : 'BESAR'}\n📝 ${scor}`;
    if (gd.dev) msg += `\n💻 DEV: ${gd.dev}`;
    if (gd.rol) msg += `\n🌐 ROL: ${gd.rol}`;
    msg += '\n\n📋 SALDO:\n';
    for (const [n, s] of Object.entries(gd.saldo)) if (s !== 0) msg += `${n}: ${s}\n`;
    await client.sendMessage(chatId, msg);
}

client.on('message', async (message) => {
    if (!message.body || message.isStatus) return;
    const body = message.body.toLowerCase();
    const chatId = message.from;
    const userId = message.author || message.from;

    // REKAP
    if (body === '/rekapwin' || body.startsWith('/rekapwin ')) {
        const parts = message.body.split(' ');
        if (parts.length < 2) return client.sendMessage(chatId, '⚠️ Fee wajib. Contoh: /rekapwin 6');
        const fee = parseFloat(parts[1]) || 6;
        if (!message.hasQuotedMsg) return client.sendMessage(chatId, '⚠️ Balas pesan data duel.');
        const quoted = await message.getQuotedMessage();
        const isi = quoted.body.toUpperCase();
        const k = isi.match(/K[ECIL]*\s*:(.*?)(?=B[ESAR]*\s*:|$)/s);
        const b = isi.match(/B[ESAR]*\s*:(.*?)(?=K[ECIL]*\s*:|$)/s);
        if (!k || !b) return client.sendMessage(chatId, '⚠️ Format salah. Harus ada K: dan B:.');
        const gd = game_data.get(chatId) || { games: [], dev: '', rol: '', saldo: {} };
        const id = gd.games.length + 1;
        game_data.set(chatId, gd);
        rekap_data.set(chatId, { game_id: id, k: parseData(k[1].trim().split('\n')), b: parseData(b[1].trim().split('\n')), fee, user_id: userId, step: 'win' });
        await client.sendMessage(chatId, `📊 REKAP GAME ${id}\nPilih pemenang:\n1️⃣ KECIL\n2️⃣ BESAR`);
        return;
    }

    // RESPONSES
    if (message.hasQuotedMsg) {
        const data = rekap_data.get(chatId);
        if (!data) return;
        if (data.user_id !== userId) return client.sendMessage(chatId, '⚠️ Bukan user yang memulai.');
        if (data.step === 'win') {
            const s = message.body.trim();
            if (s === '1' || s === '2') {
                data.win = s === '1' ? 'K' : 'B';
                data.step = 'scor';
                await client.sendMessage(chatId, 'Pilih skor:\n1️⃣ 2-0\n2️⃣ 2-1');
                rekap_data.set(chatId, data);
            }
        } else if (data.step === 'scor') {
            const s = message.body.trim();
            if (s === '1' || s === '2') {
                data.scor = s === '1' ? '2-0' : '2-1';
                data.step = 'rol';
                await client.sendMessage(chatId, 'Pilih browser:\n1️⃣ SAFARI\n2️⃣ GOOGLE\n3️⃣ CHROME');
                rekap_data.set(chatId, data);
            }
        } else if (data.step === 'rol') {
            const m = { '1': 'SAFARI', '2': 'GOOGLE', '3': 'CHROME' };
            if (m[message.body.trim()]) {
                const gd = game_data.get(chatId) || {};
                gd.rol = m[message.body.trim()];
                game_data.set(chatId, gd);
                data.step = 'dev';
                await client.sendMessage(chatId, 'Masukkan nama device:');
                rekap_data.set(chatId, data);
            }
        } else if (data.step === 'dev') {
            const gd = game_data.get(chatId) || {};
            gd.dev = message.body.trim().toUpperCase();
            game_data.set(chatId, gd);
            await kirim_rekap(chatId);
        }
    }

    // CEK SALDO
    if (body === '/ceksaldo') {
        const gd = game_data.get(chatId);
        if (!gd || !gd.saldo || Object.keys(gd.saldo).length === 0) return client.sendMessage(chatId, '📊 Belum ada data.');
        let msg = '📊 SALDO PEMAIN\n';
        for (const [n, s] of Object.entries(gd.saldo)) if (s !== 0) msg += `${n}: ${s}\n`;
        await client.sendMessage(chatId, msg);
    }

    // CEK GAME
    if (body === '/cekgame') {
        const gd = game_data.get(chatId);
        if (!gd || !gd.games || gd.games.length === 0) return client.sendMessage(chatId, '📋 Belum ada game.');
        let msg = '📋 HISTORY GAME\n';
        for (const g of gd.games) msg += `${g}\n`;
        if (gd.dev) msg += `\n💻 DEV: ${gd.dev}`;
        if (gd.rol) msg += `\n🌐 ROL: ${gd.rol}`;
        await client.sendMessage(chatId, msg);
    }

    // RESET
    if (body === '/resetlw') {
        if (!is_owner(userId)) return client.sendMessage(chatId, '⚠️ Hanya owner.');
        game_data.set(chatId, { games: [], dev: '', rol: '', saldo: {} });
        rekap_data.delete(chatId);
        await client.sendMessage(chatId, '✅ Reset berhasil.');
    }

    // SEWA
    if (body === '/sewabot' || body.startsWith('/sewabot ')) {
        if (!is_owner(userId)) return client.sendMessage(chatId, '⚠️ Hanya owner.');
        const parts = message.body.split(' ');
        if (parts.length < 2) return client.sendMessage(chatId, 'Format: /sewabot 1bulan');
        const durasi = parts[1].toLowerCase();
        sewabot_map.set(chatId, { paket: durasi, expire: durasi === 'permanen' ? null : Math.floor(Date.now()/1000) + 2592000 });
        await client.sendMessage(chatId, `✅ Sewa ${durasi} aktif!`);
    }

    // HELP
    if (body === '/help' || body === '/start') {
        await client.sendMessage(chatId, '🤖 BOT REKAP GAME\n/rekapwin [fee] - Rekap\n/ceksaldo - Saldo\n/cekgame - History\n/resetlw - Reset\n/sewabot - Sewa (owner)\n/help - Bantuan');
    }
});

client.on('ready', () => console.log('✅ Bot Aktif!'));
console.log('🚀 Starting...');
client.initialize();

setTimeout(async () => {
    try { console.log(`🔑 PAIRING CODE: ${await client.requestPairingCode()}`); } 
    catch(e) { console.log('⏳ Pairing code nanti...'); }
}, 30000);

console.log('🤖 Ready!');