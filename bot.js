// BK-VAPI sinyal botu
// Binance'den mum verisi ceker, BK-VAPI gostergesini hesaplar,
// AL/SAT sinyali bulursa Telegram'dan bildirim gonderir.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- AYARLAR ----
const SEMBOL = process.env.SEMBOL || 'BTCUSDT';
const PERIYOT = process.env.PERIYOT || '1m';   // 1m, 5m, 15m, 1h, 4h, 1d
const THRESHOLD = 35;
const GERIYE_BAK = 30;   // son kac kapanmis mumda sinyal aransin

const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const DURUM_DOSYASI = path.join(__dirname, 'durum.json');

// ---- GOSTERGE HESAPLARI ----

// Pine: ta.ema
function ema(arr, period) {
  const k = 2 / (period + 1);
  const out = [];
  let prev = arr[0];
  for (let i = 0; i < arr.length; i++) {
    prev = i === 0 ? arr[0] : arr[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

// Pine: calc_wima -> MA_s = (src + nz(MA_s[1]) * (length-1)) / length
function wima(arr, length) {
  const out = [];
  let prev = 0;
  for (let i = 0; i < arr.length; i++) {
    prev = (arr[i] + prev * (length - 1)) / length;
    out.push(prev);
  }
  return out;
}

function bkvapiHesapla(closes) {
  const periods = 6;
  const smooth = 14;

  const r1 = ema(closes, periods);
  const r2 = closes.map((c, i) => (c > r1[i] ? c - r1[i] : 0));
  const r3 = closes.map((c, i) => (c < r1[i] ? r1[i] - c : 0));
  const r4 = wima(r2, smooth);
  const r5 = wima(r3, smooth);
  const rr = r5.map((v, i) => (v === 0 ? 100 : 100 - 100 / (1 + r4[i] / v)));
  const pp = ema(rr, 12);

  const kirmizi = rr.map((v) => v - 50);   // R
  const sari = pp.map((v) => v - 50);      // R(EMA)
  return { kirmizi, sari };
}

// ---- VERI CEKME ----
async function mumlariGetir() {
  const url = `https://api.binance.com/api/v3/klines?symbol=${SEMBOL}&interval=${PERIYOT}&limit=500`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance hatasi: ${res.status} ${await res.text()}`);
  const data = await res.json();
  // Son mum henuz kapanmadi -> at
  const kapanmis = data.slice(0, -1);
  return kapanmis.map((k) => ({ kapanisZamani: k[6], kapanis: parseFloat(k[4]) }));
}

// ---- DURUM ----
function durumOku() {
  try {
    return JSON.parse(fs.readFileSync(DURUM_DOSYASI, 'utf8'));
  } catch {
    return { sonSat: 0, sonAl: 0 };
  }
}

function durumYaz(durum) {
  fs.writeFileSync(DURUM_DOSYASI, JSON.stringify(durum, null, 2));
}

// ---- TELEGRAM ----
async function telegramGonder(mesaj) {
  if (!TOKEN || !CHAT_ID) {
    console.log('[UYARI] TELEGRAM_TOKEN veya TELEGRAM_CHAT_ID tanimli degil, mesaj gonderilmedi.');
    console.log('Gonderilecekti:', mesaj);
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text: mesaj }),
  });
  if (!res.ok) throw new Error(`Telegram hatasi: ${res.status} ${await res.text()}`);
  console.log('Telegram mesaji gonderildi.');
}

function zamanYaz(ms) {
  return new Date(ms).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
}

// ---- ANA AKIS ----
async function main() {
  const mumlar = await mumlariGetir();
  const closes = mumlar.map((m) => m.kapanis);
  const { kirmizi, sari } = bkvapiHesapla(closes);

  const durum = durumOku();
  const yeniDurum = { ...durum };
  const bildirimler = [];

  const basla = Math.max(1, mumlar.length - GERIYE_BAK);
  for (let i = basla; i < mumlar.length; i++) {
    const zaman = mumlar[i].kapanisZamani;

    // SAT: sari cizgi 35 ustundeyken kirmizinin altina indi
    const sat = sari[i - 1] >= kirmizi[i - 1] && sari[i] < kirmizi[i] && sari[i] > THRESHOLD;
    // AL: kirmizi cizgi 0 altindayken sarinin ustune cikti
    const al = kirmizi[i - 1] <= sari[i - 1] && kirmizi[i] > sari[i] && kirmizi[i] < 0;

    if (sat && zaman > (durum.sonSat || 0)) {
      bildirimler.push(
        `🔻 BK-VAPI SAT sinyali\n${SEMBOL} · ${PERIYOT}\n${zamanYaz(zaman)}\n` +
        `Sari cizgi 35 ustundeyken kirmizinin altina indi.\n` +
        `R: ${kirmizi[i].toFixed(2)} | R(EMA): ${sari[i].toFixed(2)} | Fiyat: ${closes[i]}`
      );
      yeniDurum.sonSat = zaman;
    }

    if (al && zaman > (durum.sonAl || 0)) {
      bildirimler.push(
        `🔺 BK-VAPI AL sinyali\n${SEMBOL} · ${PERIYOT}\n${zamanYaz(zaman)}\n` +
        `Kirmizi cizgi 0 altindayken sarinin ustune cikti.\n` +
        `R: ${kirmizi[i].toFixed(2)} | R(EMA): ${sari[i].toFixed(2)} | Fiyat: ${closes[i]}`
      );
      yeniDurum.sonAl = zaman;
    }
  }

  const son = mumlar.length - 1;
  console.log(
    `${SEMBOL} ${PERIYOT} | Fiyat: ${closes[son]} | ` +
    `R: ${kirmizi[son].toFixed(2)} | R(EMA): ${sari[son].toFixed(2)} | ` +
    `Yeni sinyal: ${bildirimler.length}`
  );

  for (const mesaj of bildirimler) {
    await telegramGonder(mesaj);
  }

  durumYaz(yeniDurum);
}

main().catch((err) => {
  console.error('HATA:', err.message);
  process.exit(1);
});
