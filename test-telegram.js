// Telegram baglanti testi
const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!TOKEN) { console.error('HATA: TELEGRAM_TOKEN bulunamadi (.env dosyasini kontrol edin)'); process.exit(1); }
if (!CHAT_ID) { console.error('HATA: TELEGRAM_CHAT_ID bulunamadi (.env dosyasini kontrol edin)'); process.exit(1); }

const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    chat_id: CHAT_ID,
    text: '✅ BK-VAPI botu baglandi!\n\nBu bir test mesajidir. Bundan sonra AL/SAT sinyali olustugunda buraya bildirim gelecek.',
  }),
});

const sonuc = await res.json();
if (sonuc.ok) {
  console.log('BASARILI: Telegram mesaji gonderildi. Telefonunuzu kontrol edin.');
} else {
  console.error('BASARISIZ. Telegram cevabi:', sonuc.description || JSON.stringify(sonuc));
  process.exit(1);
}
