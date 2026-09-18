const sampleText = `
16/09/26 VI.CLA. FUTURE S.R.L.
VIALE MICHELANGELO 33
ANTONIO AVERSANO 80129 NAPOLI NA
Porto Franco % Mezzo Destinatario MAG.PRINCIPALE PREVENTIVO 2644312 14/09/26 1
3382631440 006423 999 05485601214
I PREZZI DEGLI ARTICOLI NELLA PRESENTE OFFERTA 208/2026 Bonifico 120 gg.
SONO AL NETTO DELL'IVA del 0/00/00
50534 STILE+ LED 11 SE/SA 1/2H PZ 1 24,900 1 24,900 Dispon. 22
20120 RELE AD IMPULSI PZ 3 7,900 1 23,700 Dispon. 22
1262 MINICANALI COP. AVVOLGENTE 40X LM 10 3,559 1 35,590 Da ord. 22
17 (2
51853 DEVIAZIONE INTERNA REGOLABILE PZ 2 91,744 100 1,835 Dispon. 22
40X17
51850 DEVIAZIONE ESTERNA REGOLABILE PZ 2 98,160 100 1,963 Dispon. 22
40X17
33981 MINICANALA 16X25 CON COP. MT 10 1,490 1 14,900 Dispon. 22
75977 16X25 ACCESSORIO PER CURVE, AN PZ 2 1,938 1 3,876 Dispon. 22
GOLI E T
51410 SCATOLA X DERIV. X B40/100 H40 PZ 1 20,548 1 20,548 Dispon. 22
/60 BIANCO
19466 SCAT. INC. 3P CARTON. GESSO PZ 1 1,166 1 1,166 Dispon. 22
19467 SCAT. INC. 4P PER CARTONGESSO PZ 1 1,672 1 1,672 Dispon. 22
55928 SCATOLA DERIV. PER CARTONGESSO PZ 1 6,478 1 6,478 Dispon. 22
198X153X70
44316 SCATOLA DER.150X110 S/PAS.IP56 PZ 1 2,790 1 2,790 Dispon. 22
29233 CENTRALINO ESTERNO IP65 4P PZ 1 1290,000 100 12,900 Dispon. 22
60168 PRESSACAVI C/CONTRODADO PASSO PZ 2 0,800 1 1,600 Dispon. 22
PG 21 IP68
60169 PRESSACAVI C/CONTRODADO PASSO PZ 2 1,490 1 2,980 Dispon. 22
PG 29 IP68
66489 FS18OR18 450/750V 3G1,5 MT 100 799,000 1000 79,900 Dispon. 22
MA M
10016 LINEA SPACE - CENTRALINO INCAS PZ 1 47,097 1 47,097 Dispon. 22
SO 24M BIANCO
75095 Condensatore relè impulsi 1,5 PZ 15 4,360 1 65,400 Dispon. 22
µF/250V
349,30 76,85 426,15
`;

// Regex matching standard procurement line
const lineRegex = /^([A-Za-z0-9\-_./]{2,20})\s+(.+?)\s+(PZ|LM|MT|NR|KG|LT|CF|SET|M|MQ|MC)\s+([0-9]+(?:[.,][0-9]+)?)\s+([0-9]+(?:[.,][0-9]+)?)(?:\s+([0-9]+))?(?:\s+([0-9]+(?:[.,][0-9]+)?))?/i;

const rawLines = sampleText.split('\n').map(l => l.trim()).filter(Boolean);
const items = [];
let currentItem = null;

for (let i = 0; i < rawLines.length; i++) {
  const line = rawLines[i];
  const m = line.match(lineRegex);
  if (m) {
    if (currentItem) items.push(currentItem);
    const code = m[1];
    const desc = m[2];
    const um = m[3].toUpperCase();
    const qty = parseFloat(m[4].replace(',', '.'));
    const rawPrice = parseFloat(m[5].replace(',', '.'));
    const mult = m[6] ? parseFloat(m[6]) : 1;
    const rowVal = m[7] ? parseFloat(m[7].replace(',', '.')) : null;

    let unitPrice = rawPrice;
    if (mult > 1 && rowVal) {
      unitPrice = rowVal / qty;
    } else if (mult > 1) {
      unitPrice = rawPrice / mult;
    }

    currentItem = {
      code,
      description: desc,
      unit: um,
      qty,
      unitPrice: Math.round(unitPrice * 1000) / 1000,
      total: rowVal ? Math.round(rowVal * 100) / 100 : Math.round(qty * unitPrice * 100) / 100,
      notes: mult > 1 ? `Moltiplicatore: ${mult}` : ''
    };
  } else if (currentItem) {
    // Check if line is a continuation of description
    if (!line.startsWith('349,30') && !line.includes('VI.CLA') && !line.includes('Porto') && !line.includes('PREVENTIVO') && line.length < 50) {
      currentItem.description += ' ' + line;
    }
  }
}
if (currentItem) items.push(currentItem);

console.log('Detected items count:', items.length);
console.log('Items sample:', JSON.stringify(items, null, 2));
const totalCalc = items.reduce((acc, it) => acc + (it.total || 0), 0);
console.log('Total items value sum:', totalCalc.toFixed(2), '(Expected in quote: 349.30)');
