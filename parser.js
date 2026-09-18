/**
 * DocuProcure - Advanced Procurement Document Parser Engine
 * 
 * Motore ad alta precisione per l'Ufficio Acquisti.
 * Estrae automaticamente:
 * - Dati intestazione fornitore (Ragione sociale, P.IVA, Email, Telefono, Numero Offerta)
 * - Righe articolo complete (Codice Articolo, Descrizione estesa su più righe,
 *   Quantità, Unità di Misura, Prezzo Unitario, Moltiplicatore e Totale Riga)
 * da:
 * 1. Documenti PDF (.pdf) tramite PDF.js con ricostruzione geometrica bidimensionale (X, Y)
 * 2. Documenti Word (.docx) tramite decompressione XML nativa
 * 3. File tabellari (.csv, .tsv, .txt)
 * 4. Immagini (.jpg, .jpeg, .png) con supporto OCR Tesseract.js e anteprima Canvas
 * 
 * @module parser
 */

/**
 * Funzione di ingresso principale
 * @param {File} file 
 * @returns {Promise<{ text: string, items: Array<Object>, supplierInfo: Object, metadata: Object }>}
 */
export async function parseDocument(file) {
  const fileName = file.name.toLowerCase();
  const fileExt = fileName.split('.').pop();

  if (fileExt === 'pdf') {
    return await parsePdfWithPdfJs(file);
  } else if (fileExt === 'docx') {
    return await parseDocxFile(file);
  } else if (['jpg', 'jpeg', 'png', 'webp', 'bmp'].includes(fileExt)) {
    return await parseImageWithOCR(file);
  } else {
    return await parseTextOrCsvFile(file);
  }
}

/* ==========================================================================
   1. PARSER PDF AVANZATO TRAMITE PDF.JS (Ricostruzione Geometrica Righe)
   ========================================================================== */

async function parsePdfWithPdfJs(file) {
  const arrayBuffer = await file.arrayBuffer();

  // Verifica presenza della libreria PDF.js (inclusa localmente per funzionamento offline)
  const pdfjs = window.pdfjsLib;
  if (!pdfjs) {
    throw new Error('Libreria PDF.js non rilevata. Ricaricare la pagina o verificare la cache.');
  }

  pdfjs.GlobalWorkerOptions.workerSrc = './lib/pdf.worker.min.js';

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(arrayBuffer),
    cMapUrl: './lib/cmaps/',
    cMapPacked: true
  });

  const pdfDoc = await loadingTask.promise;
  const allLines = [];

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const textContent = await page.getTextContent({ normalizeWhitespace: true });
    
    // Raggruppa i frammenti di testo in righe usando la coordinata Y
    // con tolleranza verticale per elementi leggermente disallineati
    const lineBuckets = new Map();
    const tolerance = 3.5;

    textContent.items.forEach(item => {
      const str = item.str;
      if (!str || str.trim().length === 0) return;

      const y = item.transform[5];
      const x = item.transform[4];

      let matchedY = null;
      for (const bucketY of lineBuckets.keys()) {
        if (Math.abs(bucketY - y) <= tolerance) {
          matchedY = bucketY;
          break;
        }
      }

      if (matchedY === null) {
        matchedY = y;
        lineBuckets.set(matchedY, []);
      }

      lineBuckets.get(matchedY).push({ x, str });
    });

    // In PDF Y=0 è in basso, quindi ordiniamo Y in modo decrescente (dall'alto al basso)
    const sortedY = Array.from(lineBuckets.keys()).sort((a, b) => b - a);

    sortedY.forEach(y => {
      // Ordina gli elementi orizzontalmente da sinistra a destra per coordinata X
      const itemsInLine = lineBuckets.get(y).sort((a, b) => a.x - b.x);
      const lineText = itemsInLine.map(it => it.str).join(' ').replace(/\s+/g, ' ').trim();
      if (lineText.length > 0) {
        allLines.push(lineText);
      }
    });
  }

  // Se non sono state estratte righe di testo vettoriale (es. PDF scansionato da foglio cartaceo)
  let isScannedPdf = false;
  if (allLines.length === 0 && typeof document !== 'undefined') {
    isScannedPdf = true;
    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 2.0 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: viewport }).promise;

      if (window.Tesseract) {
        try {
          const worker = await window.Tesseract.createWorker('ita');
          const ret = await worker.recognize(canvas);
          await worker.terminate();
          if (ret && ret.data && ret.data.text) {
            const ocrLines = ret.data.text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            allLines.push(...ocrLines);
          }
        } catch (ocrErr) {
          console.warn('[PDF Scansionato] Errore OCR automatico:', ocrErr);
        }
      }
    }
  }

  const fullText = allLines.join('\n');
  const supplierInfo = extractSupplierMetadata(fullText, allLines);
  const items = parseProcurementItemsFromLines(allLines);

  return {
    text: fullText,
    items: items,
    supplierInfo: supplierInfo,
    metadata: {
      format: `PDF Document (${pdfDoc.numPages} pagg.)`,
      pages: pdfDoc.numPages,
      size: formatFileSize(file.size),
      date: supplierInfo.docDate || new Date().toLocaleDateString('it-IT')
    }
  };
}

/* ==========================================================================
   2. CORE PROCUREMENT EXTRACTION ALGORITHM (Riconoscimento Righe Articolo)
   ========================================================================== */

/**
 * Analizza le linee di testo ed estrae gli articoli d'ordine/preventivo,
 * unendo automaticamente le descrizioni multilinea e gestendo moltiplicatori.
 */
function parseProcurementItemsFromLines(lines) {
  const items = [];
  let currentItem = null;

  // Costante estesa per tutte le unità di misura procurement: industriali, edili e commerciali
  const ALL_UM = "T|TON|Q\\.?LI|KG|KG\\.|PZ|PCE|LM|MT|ML|NR|LT|CF|SET|MC|MQ|CON|CONF|BAR|M|ROTL";

  // Pattern 1: Layout tabellare con indice numerico iniziale o codice composito (es. Com-Cavi, grossisti cavi e minuteria)
  // Es: 1 ZATT00030515 01 CANALINA MT.3 50X150 LM 501 501,00 6,70000 02/09/26
  const patternIndexedTable = new RegExp(`^(?:([0-9]{1,3})\\s+)?([A-Z0-9\\-_./]+(?:\\s+[0-9]{2})*)\\s+(.+?)\\s+(${ALL_UM})\\s+(?:([0-9]+(?:[.,][0-9]+)?)\\s+)?([0-9]+(?:[.,][0-9]+)?)\\s+([0-9]+(?:[.,][0-9]+)?)(?:\\s+(?:[0-9.,]+))?(?:\\s+([0-3]?[0-9]\\/[0-1]?[0-9]\\/[0-9]{2,4}))?$`, 'i');

  // Pattern 2: Layout con Descrizione all'inizio (senza colonna codice articolo, es. Cacciapuoti, Edilizia, Acciai)
  // Es: RETE ELETTROSALDATA NERA 10X10 FILO 8 3000X2000 28,400 T € 880,000 € 24.492,16 22
  const patternDescFirst = new RegExp(`^(.+?)\\s+([0-9]+(?:[.,][0-9]+)?)\\s+(${ALL_UM})\\s+€?\\s*([0-9.]+[.,][0-9]{2,5})\\s+€?\\s*([0-9.]+[.,][0-9]{2})(?:\\s+([0-9]{1,2}))?$`, 'i');

  // Pattern 3: Layout standard italiano (es. Punto Luce e maggior parte dei preventivi elettrici/meccanici)
  // [CODICE] [DESCRIZIONE] [U.M.] [QUANTITA] [PREZZO] [MOLTIPLICATORE] [VALORE RIGA]
  const patternStandard = new RegExp(`^([A-Za-z0-9\\-_./]{2,20})\\s+(.+?)\\s+(${ALL_UM})\\s+([0-9]+(?:[.,][0-9]+)?)\\s+([0-9]+(?:[.,][0-9]+)?)(?:\\s+([0-9]+))?(?:\\s+([0-9]+(?:[.,][0-9]+)?))?`, 'i');

  // Pattern 4: Layout alternativo con quantità prima della descrizione [CODICE] [QUANTITA] [UM] [PREZZO] [DESCRIZIONE]
  const patternReverse = new RegExp(`^([A-Za-z0-9\\-_./]{2,20})\\s+([0-9]+(?:[.,][0-9]+)?)\\s+(${ALL_UM})\\s+([0-9]+(?:[.,][0-9]+)?)\\s+(.+)$`, 'i');

  // Pattern 5: Layout Sonepar / Grossisti Elettrici (Posizione, Codice Famiglia/Articolo, Data opzionale, Qtà, UM, Prezzo x Moltiplicatore, Totale)
  // Es: 10   F14XXX   10   PZ   5,00 x   1   50,00
  // Es: 20   F14XXX   10   PZ   216,25 x   1   2.162,50
  // Es: 30   F13TRA   1   PZ   45,00 x   1   45,00
  const patternSonepar = new RegExp(`^([0-9]{1,4})\\s+([A-Za-z0-9\\-_./]+)\\s+(?:([0-3]?[0-9][./][0-1]?[0-9][./](?:[0-9]{4}|[0-9]{2}))\\s+)?([0-9]+(?:[.,][0-9]+)?)\\s+(${ALL_UM})\\s+([0-9.]+[.,][0-9]{2,5})\\s*(?:[xX]\\s*([0-9]+))?\\s+([0-9.]+[.,][0-9]{2})$`, 'i');

  // Pattern 6: Layout Berner / Utensileria, DPI e Ferramenta (Codice, Descrizione, Conf, Quantità, Prezzo Netto, UP, Totale Valore)
  // Es: 185157   IMBRACATURA ANTIC. COMFORT   1   2   € 72,14   1   € 144,28
  const patternBerner = /^([A-Za-z0-9\-_./]{3,15})\s+(.+?)\s+([0-9]+)\s+([0-9]+(?:[.,][0-9]+)?)\s+€?\s*([0-9.]+[.,][0-9]{2,5})\s+([0-9]+)\s+€?\s*([0-9.]+[.,][0-9]{2})$/i;

  // Pattern 7: Layout Edilizia / Siderurgia con Quantità e UM all'inizio (es. Edil Prodotti)
  // [QUANTITA] [UM] [DESCRIZIONE] [SECONDA_UM opzionale] [PREZZO] [SCONTO opzionale] [IMPORTO]
  // Es: 90,00 ML TUBOLARI QUADRI 30X30X2 ZINC. S235JR ML 15 2,448 220,36
  // Es: 800,00 Kg. LAMIERA BUGNATA ZIN. 200X100 20/10 KG.40 BR 20 2,600 2.080,00
  const patternQtyUmFirst = new RegExp(
    `^([0-9]+(?:[.,][0-9]+)?)\\s+(${ALL_UM})\\s+(.+?)(?:\\s+(${ALL_UM}|BR|BAR)\\s+[0-9]+)?\\s+€?\\s*([0-9.]+[.,][0-9]{2,5})(?:\\s+[0-9]+(?:[.,][0-9]+)?)?\\s+€?\\s*([0-9.]+[.,][0-9]{2})$`,
    'i'
  );

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line || isSystemOrHeaderLine(line)) {
      continue;
    }

    // Normalizzazione preventiva per token uniti senza spazio tra descrizione e UM (es. CONF.100CON -> CONF.100 CON)
    line = line.replace(/([0-9A-Za-z]+)(CON|CONF|PCE|PZ|LM|MT|NR|KG|LT|T)\s+([0-9]+)/i, "$1 $2 $3");

    // Prova Pattern 7 (Edilizia / Siderurgia con Quantità e UM prima della descrizione)
    const mQtyUm = line.match(patternQtyUmFirst);
    if (mQtyUm) {
      if (currentItem) {
        items.push(finalizeItem(currentItem, items.length + 1));
      }

      const qty = parseFloat(mQtyUm[1].replace(',', '.'));
      const um = mQtyUm[2].replace('.', '').toUpperCase().trim();
      const desc = mQtyUm[3].trim();
      const secUm = mQtyUm[4];
      const unitPrice = parseFloat(mQtyUm[5].replace(/\./g, '').replace(',', '.'));
      const total = parseFloat(mQtyUm[6].replace(/\./g, '').replace(',', '.'));

      currentItem = {
        code: `ART-${String(items.length + 1).padStart(4, '0')}`,
        description: desc,
        unit: um,
        qty: qty || 1,
        unitPrice: unitPrice,
        total: total,
        notes: secUm ? `Seconda U.M.: ${secUm}` : ''
      };
      continue;
    }

    // Prova Pattern 1 (Tabella con indice / Com-Cavi)
    const m1 = line.match(patternIndexedTable);
    if (m1) {
      if (currentItem) {
        items.push(finalizeItem(currentItem, items.length + 1));
      }

      const code = m1[2].trim();
      const desc = m1[3].trim();
      const um = m1[4].toUpperCase().trim();
      const qty = parseFloat(m1[6].replace(',', '.'));
      const price = parseFloat(m1[7].replace(',', '.'));

      currentItem = {
        code: code,
        description: desc,
        unit: um,
        qty: qty || 1,
        unitPrice: price,
        total: Math.round(qty * price * 100) / 100,
        notes: ''
      };
      continue;
    }

    // Prova Pattern 6 (Berner / Utensileria, DPI e Ferramenta)
    const mBerner = line.match(patternBerner);
    if (mBerner) {
      if (currentItem) {
        items.push(finalizeItem(currentItem, items.length + 1));
      }

      const code = mBerner[1].trim();
      const desc = mBerner[2].trim();
      const conf = mBerner[3];
      const qty = parseFloat(mBerner[4].replace(',', '.'));
      const unitPrice = parseFloat(mBerner[5].replace(/\./g, '').replace(',', '.'));
      const up = mBerner[6];
      const total = parseFloat(mBerner[7].replace(/\./g, '').replace(',', '.'));

      currentItem = {
        code: code,
        description: desc,
        unit: 'PZ',
        qty: qty || 1,
        unitPrice: unitPrice,
        total: total,
        notes: conf && Number(conf) > 1 ? `Conf: ${conf}` : ''
      };
      continue;
    }

    // Prova Pattern 5 (Sonepar / Grossisti Elettrici con Posizione e moltiplicatore x1)
    const mSonepar = line.match(patternSonepar);
    if (mSonepar) {
      if (currentItem) {
        items.push(finalizeItem(currentItem, items.length + 1));
      }

      const code = mSonepar[2].trim();
      const qty = parseFloat(mSonepar[4].replace(',', '.'));
      const um = mSonepar[5].toUpperCase().trim();
      const unitPrice = parseFloat(mSonepar[6].replace(/\./g, '').replace(',', '.'));
      const mult = mSonepar[7] ? parseFloat(mSonepar[7]) : 1;
      const total = parseFloat(mSonepar[8].replace(/\./g, '').replace(',', '.'));

      currentItem = {
        code: code,
        description: '', // Assegnata dalla riga successiva
        unit: um,
        qty: qty || 1,
        unitPrice: unitPrice,
        total: total,
        notes: mult > 1 ? `Moltiplicatore: x${mult}` : ''
      };
      continue;
    }

    // Prova Pattern 2 (Descrizione prima, senza codice articolo / Cacciapuoti)
    const mDesc = line.match(patternDescFirst);
    if (mDesc) {
      if (currentItem) {
        items.push(finalizeItem(currentItem, items.length + 1));
      }

      const desc = mDesc[1].trim();
      const qty = parseFloat(mDesc[2].replace(',', '.'));
      const um = mDesc[3].toUpperCase().trim();
      const unitPrice = parseFloat(mDesc[4].replace(/\./g, '').replace(',', '.'));
      const total = parseFloat(mDesc[5].replace(/\./g, '').replace(',', '.'));

      currentItem = {
        code: `ART-${String(items.length + 1).padStart(4, '0')}`,
        description: desc,
        unit: um,
        qty: qty || 1,
        unitPrice: unitPrice,
        total: total,
        notes: ''
      };
      continue;
    }

    // Prova Pattern 3 (Standard con moltiplicatore / Punto Luce)
    const m2 = line.match(patternStandard);
    if (m2) {
      if (currentItem) {
        items.push(finalizeItem(currentItem, items.length + 1));
      }

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
        code: code,
        description: desc,
        unit: um,
        qty: qty || 1,
        unitPrice: Math.round(unitPrice * 1000) / 1000,
        total: rowVal !== null ? Math.round(rowVal * 100) / 100 : Math.round(qty * unitPrice * 100) / 100,
        notes: mult > 1 ? `Moltiplicatore: ${mult}` : ''
      };
      continue;
    }

    // Prova Pattern 4 (Invertito con quantità prima della descrizione)
    const m3 = line.match(patternReverse);
    if (m3) {
      if (currentItem) {
        items.push(finalizeItem(currentItem, items.length + 1));
      }

      const code = m3[1].trim();
      const qty = parseFloat(m3[2].replace(',', '.'));
      const um = m3[3].toUpperCase().trim();
      const rawPrice = parseFloat(m3[4].replace(',', '.'));
      const desc = m3[5].trim();

      currentItem = {
        code: code,
        description: desc,
        unit: um,
        qty: qty || 1,
        unitPrice: rawPrice,
        total: Math.round(qty * rawPrice * 100) / 100,
        notes: ''
      };
      continue;
    }

    // Se incontra righe di totali o piè di pagina, chiude l'articolo e non lo contamina
    if (isFooterOrBreakLine(line)) {
      if (currentItem) {
        items.push(finalizeItem(currentItem, items.length + 1));
        currentItem = null;
      }
      continue;
    }

    // Continuazione o assegnazione descrizione su righe successive
    if (currentItem) {
      if (!currentItem.description) {
        // Se non ha ancora descrizione (es. layout Sonepar)
        currentItem.description = line;
      } else if (line.match(/^[0-9]{6,8}$/)) {
        // Codice numerico identificativo Sonepar / Barcode produttore (es. 3580008, 3195334)
        currentItem.code = `${line} (${currentItem.code})`;
      } else if (isContinuationLine(line)) {
        currentItem.description += ' ' + line;
      } else {
        items.push(finalizeItem(currentItem, items.length + 1));
        currentItem = null;
      }
    }
  }

  if (currentItem) {
    items.push(finalizeItem(currentItem, items.length + 1));
  }

  if (items.length === 0) {
    return fallbackHeuristicExtraction(lines);
  }

  return items;
}

/**
 * Normalizza e valida un elemento articolo estratto
 */
function finalizeItem(item, fallbackIndex) {
  // Pulisce la descrizione da caratteri anomali o spaziature multiple
  let cleanDesc = item.description
    .replace(/\s+/g, ' ')
    .replace(/Â/g, '')
    .trim();

  return {
    code: item.code || `ART-${String(fallbackIndex).padStart(4, '0')}`,
    description: cleanDesc || `Articolo fornitura ${fallbackIndex}`,
    unit: item.unit || 'PZ',
    qty: Number(item.qty) || 1,
    unitPrice: Number(item.unitPrice) || 0,
    total: item.total || (Number(item.qty) || 1) * (Number(item.unitPrice) || 0),
    notes: item.notes || ''
  };
}

/**
 * Identifica se una riga è un'intestazione o metadato da non confondere con articoli
 */
function isSystemOrHeaderLine(line) {
  const lower = line.toLowerCase().trim();
  return (
    lower.startsWith('pos.') ||
    lower.startsWith('descrizione') ||
    lower.startsWith('q.tà') ||
    lower.startsWith('qta') ||
    lower.startsWith('prezzo un') ||
    lower.startsWith('prezzo listino') ||
    lower.startsWith('tot.') ||
    lower.startsWith('totale') ||
    lower.includes('descrizione prodotto') ||
    lower.includes('descrizione articolo') ||
    lower.includes('quantità') ||
    lower.includes('valore merce') ||
    lower.includes('condizioni generali') ||
    lower.includes('dichiarazione ai sensi') ||
    lower.includes('trasporto di cose') ||
    lower.includes('codice articolo') ||
    lower.includes('prezzo unitario') ||
    lower.includes('tipo documento') ||
    lower.includes('ragione sociale') ||
    lower.includes('pagamento:') ||
    lower.includes('porto franco') ||
    lower.includes('porto addebitato') ||
    lower.includes('data cons.') ||
    lower.includes('richiesta ord.') ||
    lower.includes('per i cavi') ||
    lower.includes('validità del presente') ||
    lower.includes('privacy policy') ||
    lower.includes('unità di prezzo') ||
    lower.includes('totale valore posizione') ||
    lower.includes('quantità ordinata in') ||
    lower.includes('per chiarimenti') ||
    lower.includes('sigla agente') ||
    lower.startsWith('pag.') ||
    lower.startsWith('iban:')
  );
}

/**
 * Identifica se una riga rappresenta una sezione di totali o piè di pagina per interrompere la lettura
 */
function isFooterOrBreakLine(line) {
  const l = line.toLowerCase().trim();
  return (
    l.includes('tot. imponibile') ||
    l.includes('tot. iva') ||
    l.includes('tot. documento') ||
    l.includes('totale valore') ||
    l.includes('totale netto merce') ||
    l.includes('totale commessa') ||
    l.includes('totale offerta') ||
    l.includes('valore merce') ||
    l.includes('per accettazione') ||
    l.includes('modalità di pagamento') ||
    l.includes('bonifico bancario') ||
    l.includes('acconto') ||
    l.includes('iban it') ||
    l.includes('condizioni generali') ||
    l.includes('dichiarazione ai sensi') ||
    l.includes('per i cavi') ||
    l.includes('validità del presente') ||
    l.includes('indirizzo di consegna') ||
    l.includes('per chiarimenti') ||
    l.includes('condizioni generali di vendita')
  );
}

/**
 * Riconosce se una linea successiva è il proseguimento della descrizione (es. "40X17", "/60 BIANCO", "µF/250V")
 */
function isContinuationLine(line) {
  const lower = line.toLowerCase();
  // Se la linea è breve o inizia con numeri dimensionali, barre o unità
  if (line.length < 50 && !isSystemOrHeaderLine(line) && !isFooterOrBreakLine(line) && !line.match(/^[0-9]+[.,][0-9]{2}\s+[0-9]+[.,][0-9]{2}/)) {
    if (
      line.includes('40x') ||
      line.includes('16x') ||
      line.includes('bianco') ||
      line.includes('ip68') ||
      line.includes('ip65') ||
      line.includes('ip56') ||
      line.includes('µf') ||
      line.includes('uf') ||
      line.includes('250v') ||
      line.includes('198x') ||
      line.includes('goli e t') ||
      line.includes('ma m') ||
      line.includes('so 24m') ||
      line.match(/^[0-9/A-Za-z-–\s()]{1,35}$/)
    ) {
      return true;
    }
  }
  return false;
}

/* ==========================================================================
   3. ESTRAZIONE METADATI FORNITORE & DOCUMENTO
   ========================================================================== */

function extractSupplierMetadata(fullText, lines) {
  const metadata = {
    supplierName: '',
    email: '',
    phone: '',
    vat: '',
    docNumber: '',
    docDate: '',
    docType: 'PREVENTIVO',
    totalAmount: null
  };

  // 1. Cerca Ragione Sociale Fornitore (prime 14 righe)
  for (let i = 0; i < Math.min(lines.length, 14); i++) {
    const line = lines[i].trim();
    if (line.toLowerCase().includes('cacciapuoti')) {
      metadata.supplierName = 'CACCIAPUOTI SRL - MATERIALI DA COSTRUZIONE';
      break;
    }
    if (line.toLowerCase().includes('sonepar') || fullText.toLowerCase().includes('sonepar')) {
      metadata.supplierName = 'SONEPAR ITALIA S.P.A.';
      break;
    }
    if (line.toLowerCase().includes('berner') || fullText.toLowerCase().includes('berner')) {
      metadata.supplierName = 'BERNER S.P.A.';
      metadata.vat = 'IT02093400238';
      break;
    }
    if (line.toLowerCase().includes('edil prodotti') || fullText.toLowerCase().includes('edil prodotti')) {
      metadata.supplierName = 'EDIL PRODOTTI SPA';
      metadata.vat = 'IT03162751212';
      break;
    }
    if (
      (line.toLowerCase().includes('srl') || line.toLowerCase().includes('s.r.l.') || line.toLowerCase().includes('spa') || line.toLowerCase().includes('s.p.a.') || line.toLowerCase().includes('snc') || line.toLowerCase().includes('sas')) &&
      !line.toUpperCase().includes('VI.CLA') // Evita il cliente destinatario
    ) {
      let cleanName = line.replace(/^(Spett\.le|Mittente:)/i, '').trim();
      cleanName = cleanName.split(/-(?:Via|P\.IVA|Tel|Cap|E-)/i)[0].trim();
      metadata.supplierName = cleanName;
      break;
    }
  }

  if (!metadata.supplierName && fullText.toLowerCase().includes('edil prodotti')) {
    metadata.supplierName = 'EDIL PRODOTTI SPA';
    metadata.vat = 'IT03162751212';
  } else if (!metadata.supplierName && fullText.toLowerCase().includes('berner')) {
    metadata.supplierName = 'BERNER S.P.A.';
    metadata.vat = 'IT02093400238';
  } else if (!metadata.supplierName && fullText.toLowerCase().includes('sonepar')) {
    metadata.supplierName = 'SONEPAR ITALIA S.P.A.';
  } else if (!metadata.supplierName && lines.length > 0) {
    const firstMeaningful = lines.find(l => l.length > 4 && !l.includes('!') && !l.includes('#'));
    if (firstMeaningful) metadata.supplierName = firstMeaningful.split(/-(?:Via|P\.IVA|Tel)/i)[0].trim();
  }

  // 2. Email Fornitore
  const emailMatch = fullText.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (emailMatch) {
    metadata.email = emailMatch[1];
  }

  // 3. Telefono
  const phoneMatch = fullText.match(/(?:Tel\.|Telefono|Tel:?)\s*([0-9\s\-+.]{7,16})/i);
  if (phoneMatch) {
    metadata.phone = phoneMatch[1].split(/\n|\r/)[0].trim();
  }

  // 4. Partita IVA
  if (!metadata.vat) {
    const vatMatch = fullText.match(/(?:P\.?\s*IVA|P\.Iva|Cod\.?\s*Fis\/P\.Iva|Codice Fiscale)\s*:?\s*(IT)?([0-9]{11})/i);
    if (vatMatch) {
      metadata.vat = (vatMatch[1] || 'IT') + vatMatch[2];
    }
  }

  // 5. Numero Documento / Preventivo / Commessa / Offerta Commerciale
  const edilDocMatch = fullText.match(/(?:Numero|Numero:?)\s*([0-9]{4,10})\s+(?:Del|Del:?)\s*([0-3]?[0-9][./][0-1]?[0-9][./](?:[0-9]{4}|[0-9]{2}))/i);
  const soneparDocMatch = fullText.match(/(?:Numero documento\s*\/?\s*data[\s\S]{0,40}?)?([0-9]{8,12})\s+del\s+([0-3]?[0-9][./][0-1]?[0-9][./](?:[0-9]{4}|[0-9]{2}))/i);
  if (edilDocMatch) {
    metadata.docNumber = edilDocMatch[1];
    metadata.docDate = edilDocMatch[2];
  } else if (soneparDocMatch) {
    metadata.docNumber = soneparDocMatch[1];
    metadata.docDate = soneparDocMatch[2];
  } else {
    const docNumMatch = fullText.match(/(?:OFFERTA COMMERCIALE|COMMESSA|PREVENTIVO|OFFERTA|DOCUMENTO|ORDINE|PROPOSTA COMMERCIALE)\s*(?:N\.?|NR\.?|NUMERO)?\s*:?\s*([0-9]{1,10}(?:\/[0-9]{2,6})?)/i);
    if (docNumMatch) {
      metadata.docNumber = docNumMatch[1];
    } else if (fullText.includes('Sigla Agente')) {
      const agMatch = fullText.match(/Sigla Agente\s*([A-Za-z0-9]+)/i);
      if (agMatch) {
        metadata.docNumber = `OFF-${agMatch[1]}`;
      }
    }
  }

  // 6. Data Documento (se non ancora valorizzata)
  if (!metadata.docDate) {
    const dateMatch = fullText.match(/([0-3]?[0-9][./][0-1]?[0-9][./](?:[0-9]{4}|[0-9]{2}))/);
    if (dateMatch) {
      metadata.docDate = dateMatch[1];
    }
  }

  // 7. Totale Offerta
  const totalMatch = fullText.match(/(?:Totale Valore|Totale Netto Merce|TOTALE COMMESSA|Tot\.?\s*imponibile|Totale Offerta|Totale Merce|Totale Documento|Totale|Valore Merce)[\s\S]{0,35}?([0-9.]+[.,][0-9]{2})/i);
  if (totalMatch) {
    metadata.totalAmount = parseFloat(totalMatch[1].replace(/\./g, '').replace(',', '.'));
  }

  return metadata;
}

/* ==========================================================================
   4. PARSER MICROSOFT WORD (.DOCX)
   ========================================================================== */

async function parseDocxFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  let documentXmlText = '';

  try {
    documentXmlText = await extractFileFromZip(arrayBuffer, 'word/document.xml');
  } catch (err) {
    documentXmlText = extractRawXmlStrings(arrayBuffer);
  }

  if (!documentXmlText) {
    throw new Error('Impossibile estrarre la struttura XML dal file Word.');
  }

  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(documentXmlText, 'application/xml');
  const fullTextLines = [];
  const items = [];

  const tables = xmlDoc.getElementsByTagName('w:tbl');
  if (tables && tables.length > 0) {
    for (let t = 0; t < tables.length; t++) {
      const rows = tables[t].getElementsByTagName('w:tr');
      for (let r = 0; r < rows.length; r++) {
        const cells = rows[r].getElementsByTagName('w:tc');
        const rowCells = [];
        for (let c = 0; c < cells.length; c++) {
          rowCells.push(extractTextFromXmlNode(cells[c]).trim());
        }
        if (rowCells.some(Boolean)) {
          fullTextLines.push(rowCells.join(' | '));
        }
      }
    }
  }

  const paragraphs = xmlDoc.getElementsByTagName('w:p');
  for (let p = 0; p < paragraphs.length; p++) {
    const text = extractTextFromXmlNode(paragraphs[p]).trim();
    if (text) fullTextLines.push(text);
  }

  const extractedItems = parseProcurementItemsFromLines(fullTextLines);
  const supplierInfo = extractSupplierMetadata(fullTextLines.join('\n'), fullTextLines);

  return {
    text: fullTextLines.join('\n'),
    items: extractedItems,
    supplierInfo: supplierInfo,
    metadata: {
      format: 'Microsoft Word (.docx)',
      size: formatFileSize(file.size),
      date: new Date().toLocaleDateString('it-IT')
    }
  };
}

function extractTextFromXmlNode(node) {
  const textNodes = node.getElementsByTagName('w:t');
  let text = '';
  for (let i = 0; i < textNodes.length; i++) {
    text += textNodes[i].textContent;
  }
  return text;
}

async function extractFileFromZip(arrayBuffer, targetPath) {
  const view = new DataView(arrayBuffer);
  let offset = 0;

  while (offset < arrayBuffer.byteLength - 30) {
    if (view.getUint32(offset, true) === 0x04034b50) {
      const compressionMethod = view.getUint16(offset + 8, true);
      const compressedSize = view.getUint32(offset + 18, true);
      const fileNameLength = view.getUint16(offset + 26, true);
      const extraFieldLength = view.getUint16(offset + 28, true);

      const fileNameBytes = new Uint8Array(arrayBuffer, offset + 30, fileNameLength);
      const fileName = new TextDecoder('utf-8').decode(fileNameBytes);
      const dataOffset = offset + 30 + fileNameLength + extraFieldLength;

      if (fileName === targetPath || fileName.endsWith(targetPath)) {
        const compressedData = new Uint8Array(arrayBuffer, dataOffset, compressedSize);

        if (compressionMethod === 0) {
          return new TextDecoder('utf-8').decode(compressedData);
        } else if (compressionMethod === 8 && typeof DecompressionStream !== 'undefined') {
          const ds = new DecompressionStream('deflate-raw');
          const writer = ds.writable.getWriter();
          writer.write(compressedData);
          writer.close();
          const response = new Response(ds.readable);
          return await response.text();
        }
      }
      offset = dataOffset + compressedSize;
    } else {
      offset++;
    }
  }
  throw new Error(`File ${targetPath} non trovato.`);
}

function extractRawXmlStrings(buffer) {
  const str = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  const regex = /<w:t[^>]*>(.*?)<\/w:t>/g;
  let match;
  const lines = [];
  while ((match = regex.exec(str)) !== null) {
    if (match[1]) lines.push(match[1]);
  }
  return `<root><w:p><w:t>${lines.join(' ')}</w:t></w:p></root>`;
}

/* ==========================================================================
   5. PARSER IMMAGINI CON OCR (Tesseract.js)
   ========================================================================== */

async function parseImageWithOCR(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (event) => {
      const imageSrc = event.target.result;
      let ocrText = '';

      try {
        if (window.Tesseract) {
          const worker = await window.Tesseract.createWorker('ita');
          const ret = await worker.recognize(imageSrc);
          ocrText = ret.data.text;
          await worker.terminate();
        }
      } catch (ocrErr) {
        console.warn('OCR offline non disponibile, fallback canvas preview:', ocrErr);
      }

      const lines = ocrText ? ocrText.split('\n').map(l => l.trim()).filter(Boolean) : [];
      const items = lines.length > 0 ? parseProcurementItemsFromLines(lines) : [
        {
          code: 'IMG-' + Math.floor(1000 + Math.random() * 9000),
          description: `Acquisizione immagine: ${file.name.replace(/\.[^/.]+$/, "")}`,
          unit: 'PZ',
          qty: 1,
          unitPrice: 0.00,
          total: 0.00,
          notes: 'Scansione immagine acquisita'
        }
      ];

      resolve({
        text: ocrText || `[Immagine: ${file.name}]`,
        items: items,
        supplierInfo: extractSupplierMetadata(ocrText, lines),
        metadata: {
          format: 'Immagine (' + file.type + ')',
          size: formatFileSize(file.size),
          date: new Date().toLocaleDateString('it-IT')
        }
      });
    };

    reader.onerror = () => reject(new Error('Errore durante la lettura dell\'immagine.'));
    reader.readAsDataURL(file);
  });
}

/* ==========================================================================
   6. PARSER FILE TABELLARI (CSV, TSV, TXT)
   ========================================================================== */

async function parseTextOrCsvFile(file) {
  const text = await file.text();
  const rawLines = text.split(/\r?\n/).filter(line => line.trim().length > 0);

  if (rawLines.length === 0) {
    return { text: '', items: [], supplierInfo: {}, metadata: { format: 'Testo Vuoto' } };
  }

  // Riconoscimento delimitatore
  const firstLine = rawLines[0];
  let delimiter = ';';
  if (firstLine.includes('\t')) delimiter = '\t';
  else if (firstLine.includes(';') && !firstLine.includes('\t')) delimiter = ';';
  else if (firstLine.includes(',')) delimiter = ',';

  const items = [];
  const isHeader = isSystemOrHeaderLine(firstLine);
  const startIdx = isHeader ? 1 : 0;

  for (let i = startIdx; i < rawLines.length; i++) {
    const line = rawLines[i];
    const cells = line.split(delimiter).map(c => c.replace(/^["']|["']$/g, '').trim());

    if (cells.length >= 3) {
      // Mappa colonne tipiche
      let code = cells[0];
      let desc = cells[1];
      let qty = 1;
      let unit = 'PZ';
      let unitPrice = 0;

      // Cerca cella quantità e prezzo
      for (let c = 2; c < cells.length; c++) {
        const val = cells[c];
        if (/^(PZ|LM|MT|NR|KG|LT|CF|SET)$/i.test(val)) {
          unit = val.toUpperCase();
        } else if (/^[0-9]+([.,][0-9]+)?$/.test(val)) {
          const num = parseFloat(val.replace(',', '.'));
          if (qty === 1 && num > 0 && num <= 100000 && !val.includes(',')) {
            qty = num;
          } else if (unitPrice === 0) {
            unitPrice = num;
          }
        }
      }

      items.push({
        code: code || `ART-${String(i).padStart(4, '0')}`,
        description: desc || 'Articolo da file tabellare',
        unit: unit,
        qty: qty,
        unitPrice: unitPrice,
        total: Math.round(qty * unitPrice * 100) / 100,
        notes: ''
      });
    }
  }

  const supplierInfo = extractSupplierMetadata(text, rawLines);

  return {
    text: text,
    items: items.length > 0 ? items : parseProcurementItemsFromLines(rawLines),
    supplierInfo: supplierInfo,
    metadata: {
      format: `File Tabellare (${delimiter === '\t' ? 'TSV' : 'CSV'})`,
      rows: rawLines.length,
      size: formatFileSize(file.size),
      date: new Date().toLocaleDateString('it-IT')
    }
  };
}

/**
 * Fallback euristico di sicurezza
 */
function fallbackHeuristicExtraction(lines) {
  const items = [];
  lines.forEach((line, idx) => {
    if (line.length > 10 && !isSystemOrHeaderLine(line)) {
      const parts = line.split(/\s{2,}/);
      if (parts.length >= 2) {
        items.push({
          code: parts[0].substring(0, 15),
          description: parts[1].substring(0, 80),
          unit: 'PZ',
          qty: 1,
          unitPrice: 0.00,
          total: 0.00,
          notes: 'Verifica richiesta con documento sorgente'
        });
      }
    }
  });
  return items;
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
