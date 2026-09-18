// Comprehensive test of all 3 documents with clean footer stopping

const puntoLuceText = `
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

const comCaviText = `
NR ARTICOLO DESCRIZIONE UM TAGLI QUANTITÀ PREZZO %Sc. DATA CONS.
 1 ZATT00030515 01 CANALINA MT.3 50X150 LM 501 501,00 6,70000 02/09/26
 2 ZATT02010005 01 PIASTRINA GIUNZIONE 50 PCE 340 340,00 0,49000 02/09/26
 3 ZATT06210600 01 DADO FLANGIATO ZIGRINATO M 6 CONF.100 CON 7 7,00 3,20000 02/09/26
 4 ZATT06200610 01 BULL.T/TONDA C/QUADR.SOTT.M6X10 CONF.100CON 7 7,00 5,90000 02/09/26
 5 ZATF0S413000 01 20 ZF PROFILATO SEMPLICE 41X41 LM 201 201,00 7,63000 02/09/26
Totale Netto Merce: 5.120,63
TOTALE COMMESSA ESCLUSO IVA: EURO 5.120,63
`;

const cacciapuotiText = `
q.tà udm prezzo Un. importo IVA
Descrizione
RETE ELETTROSALDATA NERA 10X10 FILO 8 3000X2000 28,400 T € 880,000 € 24.492,16 22
LAMIERE NERE S355JR 1500X3000 6 MM 20,000 T € 1.100,000 € 21.560,00 22
Tot. imponibile € 46.052,16
Tot. Iva € 10.131,48
Tot. documento € 56.183,64
Modalità di pagamento
BONIFICO BANCARIO SCONTO 2 %
INTESA SANPAOLO
IBAN IT 83 H 03069 39904 100000017439
Per accettazione (firma e timbro)
`;

const ALL_UM = "T|TON|Q\\.?LI|KG|PZ|PCE|LM|MT|NR|LT|CF|SET|MC|MQ|CON|CONF|BAR|M|ROTL";

function isFooterOrBreak(line) {
  const l = line.toLowerCase();
  return (
    l.includes('tot.') ||
    l.includes('totale') ||
    l.includes('per accettazione') ||
    l.includes('modalità') ||
    l.includes('bonifico') ||
    l.includes('iban') ||
    l.includes('acconto') ||
    l.includes('valore merce') ||
    l.includes('condizioni')
  );
}

function extractAll(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const items = [];
  let currentItem = null;

  const patternIndexedTable = new RegExp(`^(?:([0-9]{1,3})\\s+)?([A-Z0-9\\-_./]+(?:\\s+[0-9]{2})*)\\s+(.+?)\\s+(${ALL_UM})\\s+(?:([0-9]+(?:[.,][0-9]+)?)\\s+)?([0-9]+(?:[.,][0-9]+)?)\\s+([0-9]+(?:[.,][0-9]+)?)(?:\\s+(?:[0-9.,]+))?(?:\\s+([0-3]?[0-9]\\/[0-1]?[0-9]\\/[0-9]{2,4}))?$`, 'i');
  const patternStandard = new RegExp(`^([A-Za-z0-9\\-_./]{2,20})\\s+(.+?)\\s+(${ALL_UM})\\s+([0-9]+(?:[.,][0-9]+)?)\\s+([0-9]+(?:[.,][0-9]+)?)(?:\\s+([0-9]+))?(?:\\s+([0-9]+(?:[.,][0-9]+)?))?`, 'i');
  const patternDescFirst = new RegExp(`^(.+?)\\s+([0-9]+(?:[.,][0-9]+)?)\\s+(${ALL_UM})\\s+€?\\s*([0-9.]+[.,][0-9]{2,5})\\s+€?\\s*([0-9.]+[.,][0-9]{2})(?:\\s+([0-9]{1,2}))?$`, 'i');

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (line.includes('ARTICOLO') && line.includes('DESCRIZIONE')) continue;
    if (line.toLowerCase().startsWith('q.tà') || line.toLowerCase().startsWith('descrizione')) continue;

    // Normalizza parole incollate
    line = line.replace(/([0-9A-Za-z]+)(CON|CONF|PCE|PZ|LM|MT|NR|KG|LT|T)\s+([0-9]+)/i, "$1 $2 $3");

    // 1. Prova Indexed (Com-Cavi)
    const m1 = line.match(patternIndexedTable);
    if (m1) {
      if (currentItem) items.push(currentItem);
      const code = m1[2].trim();
      const desc = m1[3].trim();
      const um = m1[4].toUpperCase().trim();
      const qty = parseFloat(m1[6].replace(',', '.'));
      const price = parseFloat(m1[7].replace(',', '.'));
      currentItem = {
        code,
        description: desc,
        unit: um,
        qty,
        unitPrice: price,
        total: Math.round(qty * price * 100) / 100,
        notes: ''
      };
      continue;
    }

    // 2. Prova Desc First (Cacciapuoti - nessun codice fornitore)
    const mDesc = line.match(patternDescFirst);
    if (mDesc) {
      if (currentItem) items.push(currentItem);
      const desc = mDesc[1].trim();
      const qty = parseFloat(mDesc[2].replace(',', '.'));
      const um = mDesc[3].toUpperCase().trim();
      const unitPrice = parseFloat(mDesc[4].replace(/\./g, '').replace(',', '.'));
      const total = parseFloat(mDesc[5].replace(/\./g, '').replace(',', '.'));
      currentItem = {
        code: `ART-${String(items.length + 1).padStart(4, '0')}`,
        description: desc,
        unit: um,
        qty,
        unitPrice,
        total,
        notes: ''
      };
      continue;
    }

    // 3. Prova Standard (Punto Luce)
    const m2 = line.match(patternStandard);
    if (m2) {
      if (currentItem) items.push(currentItem);
      const code = m2[1].trim();
      const desc = m2[2].trim();
      const um = m2[3].toUpperCase().trim();
      const qty = parseFloat(m2[4].replace(',', '.'));
      const rawPrice = parseFloat(m2[5].replace(',', '.'));
      const mult = m2[6] ? parseFloat(m2[6]) : 1;
      const rowVal = m2[7] ? parseFloat(m2[7].replace(',', '.')) : null;

      let unitPrice = rawPrice;
      if (mult > 1 && rowVal && qty > 0) {
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
        total: rowVal !== null ? Math.round(rowVal * 100) / 100 : Math.round(qty * unitPrice * 100) / 100,
        notes: mult > 1 ? `Moltiplicatore: ${mult}` : ''
      };
      continue;
    }

    // Se incontriamo un piè di pagina / totali, chiudiamo l'articolo e non appendiamo
    if (isFooterOrBreak(line)) {
      if (currentItem) {
        items.push(currentItem);
        currentItem = null;
      }
      continue;
    }

    // Continuazione descrizione su riga successiva
    if (currentItem && line.length < 50 && !line.startsWith('349,30')) {
      currentItem.description += ' ' + line;
    }
  }

  if (currentItem) items.push(currentItem);
  return items;
}

console.log('--- TEST 1: PUNTO LUCE SRL ---');
const plItems = extractAll(puntoLuceText);
console.log('Items:', plItems.length, 'Sum:', plItems.reduce((a,b)=>a+b.total,0).toFixed(2), '(Expected 18 / 349.31)');

console.log('--- TEST 2: COM-CAVI SPA MULTIMEDIA ---');
const ccItems = extractAll(comCaviText);
console.log('Items:', ccItems.length, 'Sum:', ccItems.reduce((a,b)=>a+b.total,0).toFixed(2), '(Expected 5 / 5120.63)');

console.log('--- TEST 3: CACCIAPUOTI MATERIALI DA COSTRUZIONE ---');
const cpItems = extractAll(cacciapuotiText);
console.log('Items:', cpItems.length, 'Sum:', cpItems.reduce((a,b)=>a+b.total,0).toFixed(2), '(Expected 2 / 46052.16)');
console.log(cpItems);
