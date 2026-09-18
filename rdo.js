/**
 * DocuProcure - Procurement RFQ & ERP Bridge Module
 * 
 * Modulo per:
 * 1. Generazione e formattazione dei dati estratti per il copia-incolla immediato su ERP (SAP, Zucchetti, TeamSystem, Excel)
 * 2. Generazione formale di Richieste d'Offerta (RdO) da inviare ai fornitori tramite email (mailto) o stampa formale
 * 
 * @module rdo
 */

/**
 * Esporta le righe articolo nel formato clipboard ottimizzato per gestionali
 * @param {Array<Object>} items 
 * @param {'tsv' | 'csv' | 'json'} format 
 * @returns {string}
 */
export function formatItemsForERP(items, format = 'tsv') {
  if (!items || items.length === 0) return '';

  if (format === 'tsv') {
    // Formato Tab-Separated: perfetto per incollare direttamente nelle griglie di SAP, Zucchetti, Excel
    const header = ['Codice Articolo', 'Descrizione', 'Quantità', 'U.M.', 'Prezzo Unit.', 'Importo Tot.', 'Note'].join('\t');
    const rows = items.map(it => [
      it.code || '',
      it.description || '',
      (it.qty || 1).toString().replace('.', ','),
      it.unit || 'PZ',
      (Number(it.unitPrice) || 0).toFixed(3).replace('.', ','),
      ((it.qty || 1) * (it.unitPrice || 0)).toFixed(2).replace('.', ','),
      it.notes || ''
    ].join('\t'));

    return [header, ...rows].join('\r\n');
  }

  if (format === 'csv') {
    // Formato standard italiano con punto e virgola
    const header = '"Codice Articolo";"Descrizione";"Quantita";"UM";"Prezzo Unitario";"Totale";"Note"';
    const rows = items.map(it => [
      `"${(it.code || '').replace(/"/g, '""')}"`,
      `"${(it.description || '').replace(/"/g, '""')}"`,
      `"${(it.qty || 1).toString().replace('.', ',')}"`,
      `"${(it.unit || 'PZ')}"`,
      `"${(Number(it.unitPrice) || 0).toFixed(3).replace('.', ',')}"`,
      `"${((it.qty || 1) * (it.unitPrice || 0)).toFixed(2).replace('.', ',')}"`,
      `"${(it.notes || '').replace(/"/g, '""')}"`
    ].join(';'));

    return [header, ...rows].join('\r\n');
  }

  if (format === 'json') {
    return JSON.stringify(items, null, 2);
  }

  return '';
}

/**
 * Formattatore specifico per Zucchetti Ad Hoc Revolution:
 * 1. Griglia Documento (Ctrl+V): Nessuna riga di intestazione (perché Ad Hoc cercherebbe di registrarla come articolo).
 *    Campi separati da tabulazione con decimali a virgola:
 *    [CodiceArticolo] \t [Descrizione] \t [UM] \t [Quantita] \t [PrezzoUnitario] \t [Sconto]
 * 2. Supporto per articoli fuori anagrafica: se l'articolo non è censito in Ad Hoc, si può impostare
 *    un codice articolo generico (es. VARIO) o lasciarlo vuoto per riga descrittiva libera.
 * @param {Array<Object>} items
 * @param {Object} options
 * @returns {string}
 */
export function formatForAdHocGrid(items, options = {}) {
  if (!items || items.length === 0) return '';
  const { genericCode = '', asDescriptive = false } = options;

  const rows = items.map(it => {
    let code = it.code || '';
    if (asDescriptive) {
      code = ''; // riga descrittiva libera
    } else if (genericCode && (!code || code.startsWith('ART-'))) {
      code = genericCode;
    }

    const desc = (it.description || '').replace(/[\t\r\n]+/g, ' ').trim();
    const um = (it.unit || 'PZ').replace('.', '').toUpperCase();
    const qty = (it.qty || 1).toString().replace('.', ',');
    const price = (Number(it.unitPrice) || 0).toFixed(4).replace('.', ',').replace(/0+$/, '').replace(/,$/, ',00');
    const discount = '0';

    return [code, desc, um, qty, price, discount].join('\t');
  });

  return rows.join('\r\n');
}

/**
 * Genera il file CSV/TXT strutturato per il modulo di Importazione Documenti di Ad Hoc Revolution.
 * Include il BOM UTF-8 (\uFEFF) per garantire la corretta visualizzazione di lettere accentate in Windows.
 * @param {Array<Object>} items
 * @param {Object} metadata
 * @param {Object} options
 * @returns {string}
 */
export function generateAdHocImportFile(items, metadata = {}, options = {}) {
  if (!items || items.length === 0) return '';
  const { vatRate = '22', genericCode = '', asDescriptive = false } = options;

  const header = ['TipoRiga', 'CodiceArticolo', 'Descrizione', 'UM', 'Quantita', 'PrezzoUnitario', 'Sconto', 'CodiceIVA', 'Note'].join(';');

  const rows = items.map(it => {
    const tipoRiga = asDescriptive ? '1' : '0'; // 0=Articolo da anagrafica, 1=Descrittiva libera
    let code = it.code || '';
    if (asDescriptive) {
      code = '';
    } else if (genericCode && (!code || code.startsWith('ART-'))) {
      code = genericCode;
    }

    const desc = `"${(it.description || '').replace(/"/g, '""').replace(/[\r\n]+/g, ' ').trim()}"`;
    const um = (it.unit || 'PZ').replace('.', '').toUpperCase();
    const qty = (it.qty || 1).toString().replace('.', ',');
    const price = (Number(it.unitPrice) || 0).toFixed(4).replace('.', ',');
    const discount = '0';
    const iva = vatRate;
    const note = `"${(it.notes || '').replace(/"/g, '""').trim()}"`;

    return [tipoRiga, code, desc, um, qty, price, discount, iva, note].join(';');
  });

  return '\uFEFF' + [header, ...rows].join('\r\n');
}

/**
 * Download file helper compatibile con browser e PWA
 * @param {string} content
 * @param {string} fileName
 * @param {string} mimeType
 */
export function downloadFile(content, fileName, mimeType = 'text/csv;charset=utf-8;') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 200);
}

/**
 * Copia il testo formattato negli appunti con fallback
 * @param {string} text 
 * @returns {Promise<boolean>}
 */
export async function copyToClipboard(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-999999px';
      textarea.style.top = '-999999px';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textarea);
      return successful;
    }
  } catch (err) {
    console.error('Errore durante la copia negli appunti:', err);
    return false;
  }
}

/**
 * Genera il testo formale completo per una Richiesta di Offerta (RdO)
 * @param {Object} rdoData
 * @returns {{ emailSubject: string, emailBody: string, htmlPrint: string }}
 */
export function generateFormalRFQ(rdoData) {
  const {
    rfqNumber = `RDO-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`,
    supplierName = 'Spett.le Fornitore',
    supplierContact = '',
    supplierEmail = '',
    deadlineDate = '',
    deliveryDate = '',
    paymentTerms = 'Rimessa Diretta 30/60 gg d.f. f.m.',
    deliveryPlace = 'Nostro Stabilimento - Ufficio Ricevimento Merci',
    incoterms = 'DDP (Reso Sdoganato)',
    items = [],
    customNotes = ''
  } = rdoData;

  const todayStr = new Date().toLocaleDateString('it-IT');
  const deadlineStr = deadlineDate ? new Date(deadlineDate).toLocaleDateString('it-IT') : 'Entro 5 giorni lavorativi';
  const deliveryStr = deliveryDate ? new Date(deliveryDate).toLocaleDateString('it-IT') : 'Da concordare';

  // 1. Oggetto Email
  const emailSubject = `Richiesta di Offerta Rif. ${rfqNumber} - Ufficio Acquisti`;

  // 2. Tabella Articoli in testo piano per email
  const itemsTextList = items.map((it, idx) => {
    const pos = String(idx + 1).padStart(2, '0');
    return `[${pos}] COD: ${it.code.padEnd(16)} | Q.TÀ: ${String(it.qty).padStart(4)} ${it.unit.padEnd(4)} | DESC: ${it.description} ${it.notes ? `(${it.notes})` : ''}`;
  }).join('\n');

  // 3. Corpo Email formale per l'ufficio acquisti
  const emailBody = 
`Spett.le ${supplierName},
${supplierContact ? `Alla cortese attenzione di: ${supplierContact}` : 'Alla cortese attenzione dell\'Ufficio Commerciale / Preventivi'},

Vi chiediamo cortesemente di formularci la Vs. migliore offerta per la fornitura dei seguenti articoli:

--------------------------------------------------------------------------------
RIFERIMENTO RdO: ${rfqNumber} del ${todayStr}
SCADENZA RICEZIONE OFFERTA: ${deadlineStr}
DATA RICHIESTA CONSEGNA: ${deliveryStr}
RESA MERCE: ${incoterms} - ${deliveryPlace}
CONDIZIONI PAGAMENTO RICHIESTE: ${paymentTerms}
--------------------------------------------------------------------------------

ELENCO MATERIALI / SPECIFICA FORNITURA:
${itemsTextList}

NOTE E PRESCRIZIONI PARTICOLARI:
- Vi preghiamo di specificare nell'offerta: tempi certi di approntamento, validità dei prezzi proposti e peso/volume colli.
- Si richiede conformità a normative vigenti e schede tecniche per articoli con codice personalizzato.
${customNotes ? `- Indicazioni speciali: ${customNotes}\n` : ''}
In attesa di un Vs. cortese e sollecito riscontro, porgiamo cordiali saluti.

Ufficio Acquisti / Procurement Department
DocuProcure Enterprise`;

  // 4. Modello HTML per la stampa o salvataggio in PDF
  const htmlPrint = `
    <div class="rdo-print-document">
      <div class="rdo-print-header">
        <div>
          <h2>RICHIESTA DI OFFERTA (RdO)</h2>
          <p class="doc-code">Protocollo: <strong>${rfqNumber}</strong> | Data emissione: <strong>${todayStr}</strong></p>
          <p><strong>Emesso da:</strong> Ufficio Acquisti</p>
        </div>
        <div class="rdo-supplier-box">
          <p class="box-label">DESTINATARIO:</p>
          <h3>${supplierName}</h3>
          ${supplierContact ? `<p>C.A.: ${supplierContact}</p>` : ''}
          ${supplierEmail ? `<p>Email: ${supplierEmail}</p>` : ''}
        </div>
      </div>

      <div class="rdo-conditions-grid">
        <div class="cond-item"><span>Termine Riscontro:</span> <strong>${deadlineStr}</strong></div>
        <div class="cond-item"><span>Data Consegna Desiderata:</span> <strong>${deliveryStr}</strong></div>
        <div class="cond-item"><span>Resa Merce:</span> <strong>${incoterms}</strong></div>
        <div class="cond-item"><span>Pagamento Richiesto:</span> <strong>${paymentTerms}</strong></div>
        <div class="cond-item" style="grid-column: 1 / -1;"><span>Luogo di Consegna:</span> <strong>${deliveryPlace}</strong></div>
      </div>

      <table class="rdo-print-table">
        <thead>
          <tr>
            <th style="width: 40px;">Pos.</th>
            <th style="width: 130px;">Codice Articolo</th>
            <th>Descrizione Tecnica / Fornitura</th>
            <th style="width: 60px; text-align: center;">Q.tà</th>
            <th style="width: 50px; text-align: center;">U.M.</th>
            <th style="width: 100px; text-align: right;">Prezzo Unit. Offerto</th>
            <th style="width: 80px; text-align: center;">Sconto %</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((it, idx) => `
            <tr>
              <td style="text-align: center;">${idx + 1}</td>
              <td class="font-mono"><strong>${escapeHtml(it.code)}</strong></td>
              <td>
                ${escapeHtml(it.description)}
                ${it.notes ? `<br><small class="text-muted"><em>${escapeHtml(it.notes)}</em></small>` : ''}
              </td>
              <td style="text-align: center;"><strong>${it.qty}</strong></td>
              <td style="text-align: center;">${escapeHtml(it.unit)}</td>
              <td class="fillable-cell"></td>
              <td class="fillable-cell"></td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      ${customNotes ? `
        <div class="rdo-print-notes">
          <strong>Note Speciali Ufficio Acquisti:</strong>
          <p>${escapeHtml(customNotes)}</p>
        </div>
      ` : ''}

      <div class="rdo-print-footer">
        <p>Si prega di restituire la presente richiesta compilata e sottoscritta per accettazione o allegare Vs. preventivo formale con riferimento al numero <strong>${rfqNumber}</strong>.</p>
        <div class="signature-line">
          <span>Timbro e Firma Ufficio Acquisti</span>
          <span>Timbro e Firma Fornitore per Accettazione</span>
        </div>
      </div>
    </div>
  `;

  return {
    rfqNumber,
    emailSubject,
    emailBody,
    htmlPrint
  };
}

/**
 * Crea un link `mailto:` con encoding URI sicuro
 */
export function buildMailtoUrl(toEmail, subject, body) {
  const encSubject = encodeURIComponent(subject);
  const encBody = encodeURIComponent(body);
  return `mailto:${toEmail || ''}?subject=${encSubject}&body=${encBody}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
