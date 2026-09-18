const cacciapuotiText = `
RETE ELETTROSALDATA NERA 10X10 FILO 8 3000X2000 28,400 T € 880,000 € 24.492,16 22
LAMIERE NERE S355JR 1500X3000 6 MM 20,000 T € 1.100,000 € 21.560,00 22
`;

// Pattern 4: Description first, then Quantity, U.M. (including T, TON, Q.LI), Unit Price with optional €, Total with optional €
const patternDescFirst = /^(.+?)\s+([0-9]+(?:[.,][0-9]+)?)\s+(T|TON|Q\.?LI|KG|PZ|PCE|LM|MT|NR|LT|CF|SET|MC|MQ|CON|CONF)\s+€?\s*([0-9.]+[.,][0-9]{2,5})\s+€?\s*([0-9.]+[.,][0-9]{2})(?:\s+([0-9]{1,2}))?$/i;

const lines = cacciapuotiText.trim().split('\n');
const items = [];

lines.forEach((line, idx) => {
  const m = line.trim().match(patternDescFirst);
  if (m) {
    const desc = m[1].trim();
    const qty = parseFloat(m[2].replace(',', '.'));
    const um = m[3].toUpperCase().trim();
    const rawPriceStr = m[4].replace(/\./g, '').replace(',', '.');
    const unitPrice = parseFloat(rawPriceStr);
    const rawTotStr = m[5].replace(/\./g, '').replace(',', '.');
    const total = parseFloat(rawTotStr);

    items.push({
      code: `ART-${String(idx + 1).padStart(4, '0')}`,
      description: desc,
      unit: um,
      qty,
      unitPrice,
      total,
      notes: 'Sconto 2% cassa applicato su totale'
    });
  } else {
    console.log('NO MATCH:', line);
  }
});

console.log('Cacciapuoti Extracted Items:', items);
const sum = items.reduce((acc, it) => acc + it.total, 0);
console.log('Total sum:', sum.toFixed(2), '(Expected: 46052.16)');
