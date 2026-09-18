/**
 * DocuProcure - Main Application Entry Point
 * 
 * Orchestratore PWA, registrazione Service Worker, gestione installazione,
 * gestione eventi Offline/Online, routing dei tab e reattività della UI.
 * 
 * @module app
 */

import { db } from './db.js';
import { parseDocument } from './parser.js';
import { 
  formatItemsForERP, 
  formatForAdHocGrid,
  generateAdHocImportFile,
  downloadFile,
  copyToClipboard, 
  generateFormalRFQ, 
  buildMailtoUrl 
} from './rdo.js';

/* ==========================================================================
   STATO GLOBALE DELL'APPLICAZIONE (In-Memory Reactive State)
   ========================================================================== */
const state = {
  currentTab: 'tab-extract',
  items: [],
  documents: [],
  suppliers: [],
  rfqs: [],
  deferredInstallPrompt: null,
  activeRdoData: null,
  isAdaptiveView: true
};

/* ==========================================================================
   1. REGISTRAZIONE SERVICE WORKER & PWA LIFECYCLE
   ========================================================================== */
async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
      console.log('[PWA] Service Worker registrato con successo, scope:', registration.scope);

      // Rileva eventuali aggiornamenti del Service Worker
      registration.onupdatefound = () => {
        const installingWorker = registration.installing;
        if (!installingWorker) return;

        installingWorker.onstatechange = () => {
          if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
            showToast('Nuova versione disponibile! L\'applicazione si aggiornerà al riavvio.', 'info');
          }
        };
      };
    } catch (error) {
      console.error('[PWA] Errore durante la registrazione del Service Worker:', error);
    }
  } else {
    console.warn('[PWA] Service Worker non supportato da questo browser.');
  }
}

/* ==========================================================================
   2. GESTIONE EVENTO BEFOREINSTALLPROMPT (Installazione Personalizzata PWA)
   ========================================================================== */
function initInstallPrompt() {
  const btnInstall = document.getElementById('btn-install');
  const bannerInstall = document.getElementById('pwa-install-banner');
  const btnBannerInstall = document.getElementById('btn-banner-install');
  const btnDismissBanner = document.getElementById('btn-dismiss-banner');

  window.addEventListener('beforeinstallprompt', (e) => {
    // Blocca il mini-infobar standard di Chrome
    e.preventDefault();
    state.deferredInstallPrompt = e;

    // Rende visibile il pulsante d'installazione nell'header e il banner
    if (btnInstall) btnInstall.style.display = 'inline-flex';
    if (bannerInstall && !localStorage.getItem('pwa_banner_dismissed')) {
      bannerInstall.style.display = 'flex';
    }
    console.log('[PWA] Evento beforeinstallprompt catturato.');
  });

  const handleInstallClick = async () => {
    if (!state.deferredInstallPrompt) return;

    state.deferredInstallPrompt.prompt();
    const choiceResult = await state.deferredInstallPrompt.userChoice;
    console.log('[PWA] Scelta installazione utente:', choiceResult.outcome);

    state.deferredInstallPrompt = null;
    if (btnInstall) btnInstall.style.display = 'none';
    if (bannerInstall) bannerInstall.style.display = 'none';
  };

  if (btnInstall) btnInstall.addEventListener('click', handleInstallClick);
  if (btnBannerInstall) btnBannerInstall.addEventListener('click', handleInstallClick);

  if (btnDismissBanner) {
    btnDismissBanner.addEventListener('click', () => {
      if (bannerInstall) bannerInstall.style.display = 'none';
      localStorage.setItem('pwa_banner_dismissed', 'true');
    });
  }

  // Notifica quando l'app è stata installata con successo
  window.addEventListener('appinstalled', () => {
    console.log('[PWA] DocuProcure è stata installata con successo.');
    showToast('DocuProcure installata con successo! Ora disponibile anche offline.', 'success');
    if (btnInstall) btnInstall.style.display = 'none';
    if (bannerInstall) bannerInstall.style.display = 'none';
  });
}

/* ==========================================================================
   3. GESTIONE STATO ONLINE / OFFLINE
   ========================================================================== */
function initNetworkStatusMonitoring() {
  const statusBadge = document.getElementById('connection-status');
  const statusLabel = document.getElementById('connection-label');

  function updateStatus() {
    const isOnline = navigator.onLine;
    if (isOnline) {
      statusBadge.classList.remove('offline');
      statusLabel.textContent = 'Online';
    } else {
      statusBadge.classList.add('offline');
      statusLabel.textContent = 'Offline (Locale)';
      showToast('Modalità Offline attiva. Tutte le funzionalità rimangono operative.', 'warning');
    }
  }

  window.addEventListener('online', () => {
    updateStatus();
    showToast('Connessione ripristinata.', 'success');
  });

  window.addEventListener('offline', updateStatus);
  updateStatus();
}

/* ==========================================================================
   4. GESTIONE TABS DI NAVIGAZIONE
   ========================================================================== */
function initTabs() {
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTabId = btn.getAttribute('data-tab');
      switchTab(targetTabId);
    });
  });

  // Gestione hashtag da URL (es. #tab-rdo)
  if (window.location.hash) {
    const requestedTab = window.location.hash.replace('#', '');
    if (document.getElementById(requestedTab)) {
      switchTab(requestedTab);
    }
  }
}

export function switchTab(tabId) {
  state.currentTab = tabId;

  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-tab') === tabId);
  });

  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.toggle('active', p.id === tabId);
  });

  // Se si passa al tab RdO, aggiorna l'anteprima
  if (tabId === 'tab-rdo') {
    updateRdoPreview();
  }

  // Se si passa al tab Articoli, adatta la tabella al testo rilevato
  if (tabId === 'tab-items') {
    requestAnimationFrame(() => smartAdjustTableLayout());
  }
}

/* ==========================================================================
   5. GESTIONE UPLOAD E DRAG & DROP DOCUMENTI
   ========================================================================== */
function initFileUpload() {
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');

  if (!dropzone || !fileInput) return;

  // Apertura file dialog al click sulla dropzone
  dropzone.addEventListener('click', () => fileInput.click());

  // Gestione selezione file da dialog
  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(Array.from(e.target.files));
      fileInput.value = '';
    }
  });

  // Gestione Drag & Drop
  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('drag-over');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files.length > 0) {
      handleFiles(Array.from(dt.files));
    }
  });
}

/**
 * Elabora i file caricati tramite il parser universale
 */
async function handleFiles(files) {
  for (const file of files) {
    try {
      showToast(`Analisi documento: ${file.name}...`, 'info');
      
      const parsedData = await parseDocument(file);

      if (!parsedData.items || parsedData.items.length === 0) {
        showToast(`Nessuna riga articolo identificata in ${file.name}. Verificare il formato.`, 'warning');
        continue;
      }
      
      // Salva il documento nel database locale IndexedDB
      const docId = await db.saveDocument({
        name: file.name,
        size: file.size,
        type: file.type || file.name.split('.').pop(),
        textPreview: parsedData.text.slice(0, 500),
        itemCount: parsedData.items.length,
        supplierName: parsedData.supplierInfo ? parsedData.supplierInfo.supplierName : ''
      });

      // Gestione automatica dell'anagrafica Fornitore estratto
      if (parsedData.supplierInfo && parsedData.supplierInfo.supplierName) {
        const supInfo = parsedData.supplierInfo;
        const existingSuppliers = await db.getAllSuppliers();
        let matchedSup = existingSuppliers.find(s => 
          s.name.toLowerCase().includes(supInfo.supplierName.toLowerCase()) || 
          (supInfo.vat && s.vat === supInfo.vat)
        );

        if (!matchedSup) {
          const newSupId = await db.saveSupplier({
            name: supInfo.supplierName,
            email: supInfo.email || 'preventivi@' + supInfo.supplierName.toLowerCase().replace(/[^a-z0-9]/g, '') + '.it',
            phone: supInfo.phone || '',
            vat: supInfo.vat || '',
            contactPerson: 'Ufficio Commerciale',
            category: 'Materiale Elettrico & Componenti',
            notes: `Auto-acquisito da ${file.name}`
          });
          state.detectedSupplierId = newSupId;
        } else {
          state.detectedSupplierId = matchedSup.id;
        }
      }

      // Associa l'ID del documento alle righe estratte e salva
      const itemsToSave = parsedData.items.map(it => ({ ...it, documentId: docId }));
      await db.saveItems(itemsToSave);

      showToast(`Estratti ${parsedData.items.length} articoli con successo da ${file.name}!`, 'success');

      // Ricarica i dati e naviga direttamente alla tabella per revisione
      await refreshData();

      // Pre-seleziona il fornitore rilevato nel tab RdO
      if (state.detectedSupplierId) {
        const select = document.getElementById('rdo-supplier-select');
        if (select) select.value = state.detectedSupplierId;
      }

      switchTab('tab-items');

    } catch (err) {
      console.error('Errore durante l\'estrazione:', err);
      showToast(`Errore su ${file.name}: ${err.message}`, 'warning');
    }
  }
}

/* ==========================================================================
   6. GESTIONE TABELLA ARTICOLI & OPERAZIONI ERP
   ========================================================================== */
function initItemsTableEvents() {
  // Pulsanti di esportazione rapida Gestionale ERP
  const btnCopyTsv = document.getElementById('btn-copy-tsv');
  const btnCopyCsv = document.getElementById('btn-copy-csv');
  const btnCopyJson = document.getElementById('btn-copy-json');
  const btnClearItems = document.getElementById('btn-clear-items');
  const btnAddItem = document.getElementById('btn-add-item');

  if (btnCopyTsv) {
    btnCopyTsv.addEventListener('click', async () => {
      const tsv = formatItemsForERP(state.items, 'tsv');
      const success = await copyToClipboard(tsv);
      if (success) {
        showToast('Dati copiati in formato Excel / SAP (TSV)! Pronto per Incolla su Gestionale.', 'success');
      }
    });
  }

  if (btnCopyCsv) {
    btnCopyCsv.addEventListener('click', async () => {
      const csv = formatItemsForERP(state.items, 'csv');
      const success = await copyToClipboard(csv);
      if (success) {
        showToast('Dati copiati in formato CSV italiano (;)!', 'success');
      }
    });
  }

  if (btnCopyJson) {
    btnCopyJson.addEventListener('click', async () => {
      const json = formatItemsForERP(state.items, 'json');
      const success = await copyToClipboard(json);
      if (success) {
        showToast('JSON copiato negli appunti!', 'success');
      }
    });
  }

  if (btnClearItems) {
    btnClearItems.addEventListener('click', async () => {
      if (confirm('Sei sicuro di voler svuotare tutti gli articoli estratti?')) {
        await db.clearAllItems();
        await refreshData();
        showToast('Tabella articoli svuotata.', 'info');
      }
    });
  }

  if (btnAddItem) {
    btnAddItem.addEventListener('click', async () => {
      const newItem = {
        code: `ART-${String(state.items.length + 1).padStart(4, '0')}`,
        description: 'Nuovo articolo fornitura',
        qty: 1,
        unit: 'PZ',
        unitPrice: 0.00,
        notes: ''
      };
      await db.saveItems([newItem]);
      await refreshData();
    });
  }

  const vatRateSelect = document.getElementById('vat-rate-select');
  if (vatRateSelect) {
    vatRateSelect.addEventListener('change', () => {
      renderItemsTable();
    });
  }

  // Pulsante per alternare tra vista adattiva completa e compatta
  const btnToggleView = document.getElementById('btn-toggle-view');
  if (btnToggleView) {
    btnToggleView.addEventListener('click', () => {
      state.isAdaptiveView = !state.isAdaptiveView;
      const table = document.querySelector('.erp-table');
      if (table) {
        table.classList.toggle('compact-view', !state.isAdaptiveView);
      }
      btnToggleView.textContent = state.isAdaptiveView ? '↔️ Vista Compatta' : '↔️ Adatta al Testo';
      smartAdjustTableLayout();
      showToast(state.isAdaptiveView 
        ? 'Modalità adattiva attiva: le descrizioni mostrano tutto il testo rilevato.' 
        : 'Modalità compatta attivata.', 'info');
    });
  }

  // Listener per ridimensionamento finestra
  window.addEventListener('resize', () => {
    if (state.currentTab === 'tab-items') {
      smartAdjustTableLayout();
    }
  });
}

/**
 * Gestione specifica dell'integrazione con Zucchetti Ad Hoc Revolution (OdA / RdO)
 */
function initAdHocEvents() {
  const btnCopyAdHoc = document.getElementById('btn-copy-adhoc');
  const btnExportCsv = document.getElementById('btn-export-adhoc-csv');
  const modeSelect = document.getElementById('adhoc-code-mode');
  const genericInput = document.getElementById('adhoc-generic-code-input');
  const btnGuideToggle = document.getElementById('btn-adhoc-guide-toggle');
  const guideBox = document.getElementById('adhoc-guide-box');

  if (modeSelect && genericInput) {
    modeSelect.addEventListener('change', () => {
      genericInput.style.display = modeSelect.value === 'generic' ? 'inline-block' : 'none';
    });
  }

  if (btnGuideToggle && guideBox) {
    btnGuideToggle.addEventListener('click', () => {
      const isHidden = guideBox.style.display === 'none';
      guideBox.style.display = isHidden ? 'block' : 'none';
      btnGuideToggle.textContent = isHidden ? '❌ Chiudi Guida' : '💡 Come funziona in Ad Hoc?';
    });
  }

  function getAdHocOptions() {
    const mode = modeSelect ? modeSelect.value : 'generic';
    const genericCode = (genericInput && genericInput.value) ? genericInput.value.trim() : 'VARIO';
    const vatRateSelect = document.getElementById('vat-rate-select');
    const vatRate = vatRateSelect ? vatRateSelect.value : '22';

    return {
      asDescriptive: mode === 'descriptive',
      genericCode: mode === 'generic' ? genericCode : '',
      vatRate: vatRate
    };
  }

  if (btnCopyAdHoc) {
    btnCopyAdHoc.addEventListener('click', async () => {
      if (state.items.length === 0) {
        showToast('Nessun articolo estratto da copiare per Ad Hoc Revolution.', 'warning');
        return;
      }
      const options = getAdHocOptions();
      const text = formatForAdHocGrid(state.items, options);
      const ok = await copyToClipboard(text);
      if (ok) {
        showToast(`✅ ${state.items.length} articoli copiati per Ad Hoc Revolution! Vai sulla prima cella della griglia OdA/RdO e premi Ctrl+V.`, 'success');
      } else {
        showToast('Errore durante la copia negli appunti.', 'danger');
      }
    });
  }

  if (btnExportCsv) {
    btnExportCsv.addEventListener('click', () => {
      if (state.items.length === 0) {
        showToast('Nessun articolo estratto da esportare per Ad Hoc Revolution.', 'warning');
        return;
      }
      const options = getAdHocOptions();
      const docDate = (new Date()).toISOString().slice(0, 10).replace(/-/g, '');
      const fileName = `AdHoc_Import_${docDate}.csv`;
      const csv = generateAdHocImportFile(state.items, state.supplierInfo || {}, options);
      downloadFile(csv, fileName, 'text/csv;charset=utf-8;');
      showToast(`📁 File "${fileName}" scaricato! Pronto per Utilità -> Importazione Documenti in Ad Hoc.`, 'success');
    });
  }
}

/**
 * Funzione Intelligente di Adattamento Dinamico della Tabella al Testo Rilevato:
 * 1. Analizza la lunghezza reale di tutti i testi estratti (descrizioni, codici).
 * 2. Adatta proporzioni e larghezze minime delle colonne (es. colonna descrizione estesa).
 * 3. Converte l'input in textarea elastica ad auto-espansione verticale (scrollHeight).
 * 4. Mostra il 100% della descrizione senza troncature o tagli di parole.
 */
export function smartAdjustTableLayout() {
  const table = document.querySelector('.erp-table');
  if (!table || state.items.length === 0) return;

  const descHeaders = document.querySelectorAll('#th-desc, .col-desc');
  const codeHeaders = document.querySelectorAll('#th-code, .col-code');
  const descTextareas = table.querySelectorAll('.table-input-desc');

  // Calcolo lunghezze massime del contenuto rilevato
  const maxDescLen = state.items.reduce((max, it) => Math.max(max, (it.description || '').length), 0);
  const maxCodeLen = state.items.reduce((max, it) => Math.max(max, (it.code || '').length), 0);

  // 1. Adattamento larghezza colonna codice
  let codeWidth = '190px';
  if (maxCodeLen > 24) codeWidth = '270px';
  else if (maxCodeLen > 16) codeWidth = '230px';
  codeHeaders.forEach(el => {
    el.style.minWidth = codeWidth;
  });

  // 2. Adattamento intelligente larghezza colonna descrizione in base al testo effettivo
  let descWidth = '380px';
  if (maxDescLen > 70) descWidth = '520px';
  else if (maxDescLen > 45) descWidth = '440px';
  else if (maxDescLen > 25) descWidth = '380px';
  else descWidth = '320px';

  descHeaders.forEach(el => {
    el.style.minWidth = descWidth;
  });

  // 3. Regolazione elastica delle altezze delle descrizioni al contenuto reale
  descTextareas.forEach(textarea => {
    if (state.isAdaptiveView) {
      textarea.style.height = 'auto';
      const calculatedHeight = Math.max(38, textarea.scrollHeight);
      textarea.style.height = `${calculatedHeight}px`;
    } else {
      textarea.style.height = '36px';
    }
  });
}

/**
 * Formatta un valore numerico garantendo sempre esattamente 3 cifre decimali dopo la virgola (es. 6,700 - 0,490 - 3,200 - 5,900)
 * @param {number|string} price
 * @returns {string}
 */
export function formatUnitPrice3Decimals(price) {
  const num = typeof price === 'number' ? price : (parseFloat(String(price).replace(',', '.')) || 0);
  return num.toFixed(3).replace('.', ',');
}

/**
 * Renderizza la tabella degli articoli
 */
function renderItemsTable() {
  const tbody = document.getElementById('items-tbody');
  const emptyMessage = document.getElementById('items-empty');
  const tableWrapper = document.getElementById('table-wrapper');
  const itemsCounter = document.getElementById('items-count-badge');
  const totalAmountEl = document.getElementById('total-amount-display');
  const totalQtyEl = document.getElementById('total-qty-display');
  const vatRateSelect = document.getElementById('vat-rate-select');
  const totalVatEl = document.getElementById('total-vat-display');
  const totalGrossEl = document.getElementById('total-gross-display');

  if (!tbody) return;

  if (state.items.length === 0) {
    if (emptyMessage) emptyMessage.style.display = 'block';
    if (tableWrapper) tableWrapper.style.display = 'none';
    if (itemsCounter) itemsCounter.textContent = '0';
    if (totalAmountEl) totalAmountEl.textContent = '€ 0,00';
    if (totalQtyEl) totalQtyEl.textContent = '0';
    if (totalVatEl) totalVatEl.textContent = '€ 0,00';
    if (totalGrossEl) totalGrossEl.textContent = '€ 0,00';
    return;
  }

  if (emptyMessage) emptyMessage.style.display = 'none';
  if (tableWrapper) tableWrapper.style.display = 'block';
  if (itemsCounter) itemsCounter.textContent = String(state.items.length);

  let sumAmount = 0;
  let sumQty = 0;

  tbody.innerHTML = '';
  state.items.forEach((item, index) => {
    const row = document.createElement('tr');
    const rowTotal = (Number(item.qty) || 0) * (Number(item.unitPrice) || 0);
    sumAmount += rowTotal;
    sumQty += Number(item.qty) || 0;

    row.innerHTML = `
      <td style="width: 40px; text-align: center; color: var(--text-muted);">${index + 1}</td>
      <td class="col-code" style="min-width: 190px;">
        <input type="text" class="table-input font-mono" data-id="${item.id}" data-field="code" value="${escapeHtml(item.code)}" title="${escapeHtml(item.code)}">
      </td>
      <td class="col-desc" style="min-width: 380px;">
        <textarea class="table-input table-input-desc" data-id="${item.id}" data-field="description" rows="1" title="${escapeHtml(item.description)}">${escapeHtml(item.description)}</textarea>
      </td>
      <td style="min-width: 95px; width: 105px;">
        <input type="number" step="any" min="0" class="table-input font-mono" style="text-align: right;" data-id="${item.id}" data-field="qty" value="${item.qty}">
      <td class="col-um" style="min-width: 85px; width: 95px; text-align: center;">
        <input type="text" class="table-input table-input-um" style="text-align: center; font-weight: 600;" data-id="${item.id}" data-field="unit" value="${escapeHtml(item.unit)}" title="${escapeHtml(item.unit)}">
      </td>
      <td style="min-width: 115px; width: 125px;">
        <input type="text" inputmode="decimal" class="table-input font-mono input-unit-price" style="text-align: right;" data-id="${item.id}" data-field="unitPrice" value="${formatUnitPrice3Decimals(item.unitPrice)}" title="${formatUnitPrice3Decimals(item.unitPrice)}">
      </td>
      <td style="min-width: 110px; width: 120px; text-align: right; font-weight: 600;" class="font-mono">
        € ${rowTotal.toFixed(2).replace('.', ',')}
      </td>
      <td style="min-width: 160px;">
        <input type="text" class="table-input" data-id="${item.id}" data-field="notes" placeholder="Note / Specifiche" value="${escapeHtml(item.notes || '')}">
      </td>
      <td style="width: 50px; text-align: center;">
        <button class="btn btn-outline btn-sm btn-delete-row" data-id="${item.id}" title="Elimina riga" style="color: var(--accent-danger); padding: 0.2rem 0.4rem;">
          ✕
        </button>
      </td>
    `;
    tbody.appendChild(row);
  });

  const vatRate = vatRateSelect ? (parseFloat(vatRateSelect.value) || 0) : 22;
  const totalVat = sumAmount * (vatRate / 100);
  const totalGross = sumAmount + totalVat;

  if (totalAmountEl) totalAmountEl.textContent = `€ ${sumAmount.toFixed(2).replace('.', ',')}`;
  if (totalQtyEl) totalQtyEl.textContent = String(sumQty);
  if (totalVatEl) totalVatEl.textContent = `€ ${totalVat.toFixed(2).replace('.', ',')}`;
  if (totalGrossEl) totalGrossEl.textContent = `€ ${totalGross.toFixed(2).replace('.', ',')}`;

  // Applica adattamento intelligente al layout
  smartAdjustTableLayout();

  // Assegna evento input per il ridimensionamento elastico in tempo reale durante la modifica
  tbody.querySelectorAll('.table-input-desc').forEach(textarea => {
    textarea.addEventListener('input', (e) => {
      if (state.isAdaptiveView) {
        e.target.style.height = 'auto';
        e.target.style.height = `${Math.max(38, e.target.scrollHeight)}px`;
      }
    });
  });

  // Binding eventi modifiche inline su input e textarea
  tbody.querySelectorAll('.table-input').forEach(input => {
    input.addEventListener('change', async (e) => {
      const id = Number(e.target.getAttribute('data-id'));
      const field = e.target.getAttribute('data-field');
      let val = e.target.value;

      if (field === 'qty') {
        val = parseFloat(String(val).replace(',', '.')) || 0;
      } else if (field === 'unitPrice') {
        val = parseFloat(String(val).replace(',', '.')) || 0;
      } else if (field === 'unit') {
        val = String(val).trim().toUpperCase();
      }

      const item = state.items.find(it => it.id === id);
      if (item) {
        item[field] = val;
        await db.updateItem(item);
        renderItemsTable();
      }
    });
  });

  // Gestione focus e blur specifica per il prezzo unitario a 3 decimali
  tbody.querySelectorAll('.input-unit-price').forEach(input => {
    input.addEventListener('focus', (e) => {
      e.target.select();
    });
    input.addEventListener('blur', (e) => {
      const numVal = parseFloat(String(e.target.value).replace(',', '.')) || 0;
      e.target.value = formatUnitPrice3Decimals(numVal);
    });
  });

  // Binding eliminazione riga
  tbody.querySelectorAll('.btn-delete-row').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = Number(btn.getAttribute('data-id'));
      await db.deleteItem(id);
      await refreshData();
    });
  });
}

/* ==========================================================================
   7. GESTIONE GENERATORE RICHIESTE DI OFFERTA (RdO)
   ========================================================================== */
function initRdoEvents() {
  const supplierSelect = document.getElementById('rdo-supplier-select');
  const deadlineInput = document.getElementById('rdo-deadline');
  const deliveryInput = document.getElementById('rdo-delivery');
  const paymentInput = document.getElementById('rdo-payment');
  const incotermsInput = document.getElementById('rdo-incoterms');
  const notesInput = document.getElementById('rdo-notes');

  const btnSendEmail = document.getElementById('btn-rdo-email');
  const btnPrintRdo = document.getElementById('btn-rdo-print');
  const btnSaveRdo = document.getElementById('btn-rdo-save');

  // Aggiorna l'anteprima formale a ogni variazione dei campi
  [supplierSelect, deadlineInput, deliveryInput, paymentInput, incotermsInput, notesInput].forEach(el => {
    if (el) el.addEventListener('input', updateRdoPreview);
  });

  // Invia Email tramite client predefinito (Outlook, Thunderbird, Webmail)
  if (btnSendEmail) {
    btnSendEmail.addEventListener('click', () => {
      if (!state.activeRdoData) updateRdoPreview();
      const mailtoUrl = buildMailtoUrl(
        state.activeRdoData.supplierEmail,
        state.activeRdoData.emailSubject,
        state.activeRdoData.emailBody
      );
      window.location.href = mailtoUrl;
      showToast('Apertura client di posta in corso...', 'info');
    });
  }

  // Stampa / Esporta PDF
  if (btnPrintRdo) {
    btnPrintRdo.addEventListener('click', () => {
      window.print();
    });
  }

  // Salva RdO nello storico IndexedDB
  if (btnSaveRdo) {
    btnSaveRdo.addEventListener('click', async () => {
      if (!state.activeRdoData) updateRdoPreview();
      
      let estimatedTotal = 0;
      state.items.forEach(it => {
        estimatedTotal += (Number(it.qty) || 0) * (Number(it.unitPrice) || 0);
      });

      await db.saveRFQ({
        rfqNumber: state.activeRdoData.rfqNumber,
        supplierName: state.activeRdoData.supplierName,
        supplierEmail: state.activeRdoData.supplierEmail,
        deadlineDate: deadlineInput.value,
        deliveryDate: deliveryInput.value,
        paymentTerms: paymentInput.value,
        items: state.items,
        totalEstimated: estimatedTotal,
        notes: notesInput.value
      });

      showToast(`RdO ${state.activeRdoData.rfqNumber} archiviata nello storico!`, 'success');
      await refreshData();
    });
  }
}

function updateRdoPreview() {
  const previewContainer = document.getElementById('rdo-preview-box');
  const supplierSelect = document.getElementById('rdo-supplier-select');
  const deadlineInput = document.getElementById('rdo-deadline');
  const deliveryInput = document.getElementById('rdo-delivery');
  const paymentInput = document.getElementById('rdo-payment');
  const incotermsInput = document.getElementById('rdo-incoterms');
  const notesInput = document.getElementById('rdo-notes');

  if (!previewContainer) return;

  const selectedSupplierId = supplierSelect ? supplierSelect.value : '';
  const supplier = state.suppliers.find(s => String(s.id) === selectedSupplierId) || {};

  const rdoData = {
    rfqNumber: `RDO-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`,
    supplierName: supplier.name || 'Spett.le Fornitore Selezionato',
    supplierContact: supplier.contactPerson || '',
    supplierEmail: supplier.email || '',
    deadlineDate: deadlineInput ? deadlineInput.value : '',
    deliveryDate: deliveryInput ? deliveryInput.value : '',
    paymentTerms: paymentInput ? paymentInput.value : 'Rimessa Diretta 30/60 gg d.f. f.m.',
    incoterms: incotermsInput ? incotermsInput.value : 'DDP (Reso Sdoganato)',
    deliveryPlace: 'Nostro Stabilimento Ufficio Merci',
    items: state.items,
    customNotes: notesInput ? notesInput.value : ''
  };

  const generated = generateFormalRFQ(rdoData);
  state.activeRdoData = { ...rdoData, ...generated };

  previewContainer.innerHTML = generated.htmlPrint;
}

/* ==========================================================================
   8. GESTIONE RUBRICA FORNITORI & ARCHIVIO
   ========================================================================== */
function initSupplierEvents() {
  const form = document.getElementById('form-add-supplier');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('sup-name').value.trim();
    const email = document.getElementById('sup-email').value.trim();
    const contactPerson = document.getElementById('sup-contact').value.trim();
    const category = document.getElementById('sup-category').value.trim();

    if (!name || !email) {
      showToast('Nome fornitore ed email sono obbligatori.', 'warning');
      return;
    }

    await db.saveSupplier({
      name,
      email,
      contactPerson,
      category: category || 'Fornitore Generico',
      notes: ''
    });

    form.reset();
    showToast(`Fornitore "${name}" aggiunto alla rubrica!`, 'success');
    await refreshData();
  });
}

function renderSuppliers() {
  const list = document.getElementById('suppliers-list');
  const select = document.getElementById('rdo-supplier-select');

  if (select) {
    select.innerHTML = '<option value="">-- Seleziona Fornitore da Rubrica --</option>';
    state.suppliers.forEach(sup => {
      const opt = document.createElement('option');
      opt.value = sup.id;
      opt.textContent = `${sup.name} (${sup.category || 'Generico'})`;
      select.appendChild(opt);
    });
  }

  if (!list) return;

  if (state.suppliers.length === 0) {
    list.innerHTML = '<p class="text-muted" style="font-size: 0.85rem;">Nessun fornitore in rubrica.</p>';
    return;
  }

  list.innerHTML = '';
  state.suppliers.forEach(sup => {
    const card = document.createElement('div');
    card.className = 'supplier-card';
    card.innerHTML = `
      <div>
        <h4>${escapeHtml(sup.name)}</h4>
        <div class="supplier-details">
          <p>📧 ${escapeHtml(sup.email)} | 👤 ${escapeHtml(sup.contactPerson || 'N/D')}</p>
          <p>🏷️ Categoria: <strong>${escapeHtml(sup.category || 'Generico')}</strong></p>
        </div>
      </div>
      <button class="btn btn-outline btn-sm btn-delete-sup" data-id="${sup.id}" style="color: var(--accent-danger);">
        Elimina
      </button>
    `;
    list.appendChild(card);
  });

  list.querySelectorAll('.btn-delete-sup').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      await db.deleteSupplier(id);
      await refreshData();
    });
  });
}

function renderRfqHistory() {
  const list = document.getElementById('rfq-history-list');
  if (!list) return;

  if (state.rfqs.length === 0) {
    list.innerHTML = '<p class="text-muted" style="font-size: 0.85rem;">Nessuna RdO archiviata.</p>';
    return;
  }

  list.innerHTML = '';
  state.rfqs.forEach(rfq => {
    const card = document.createElement('div');
    card.className = 'rfq-history-card';
    card.innerHTML = `
      <div>
        <h4>${escapeHtml(rfq.rfqNumber)}</h4>
        <div class="rfq-details">
          <p>Fornitore: <strong>${escapeHtml(rfq.supplierName)}</strong></p>
          <p>Articoli inclusi: ${rfq.items ? rfq.items.length : 0} | Emesso: ${new Date(rfq.timestamp).toLocaleDateString('it-IT')}</p>
        </div>
      </div>
      <button class="btn btn-outline btn-sm btn-delete-rfq" data-id="${rfq.id}" style="color: var(--accent-danger);">
        Elimina
      </button>
    `;
    list.appendChild(card);
  });

  list.querySelectorAll('.btn-delete-rfq').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      await db.deleteRFQ(id);
      await refreshData();
    });
  });
}

/* ==========================================================================
   9. SISTEMA NOTIFICHE TOAST NON BLOCCANTI
   ========================================================================== */
export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(100%)';
    toast.style.transition = 'all 0.25s ease';
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 250);
  }, 3500);
}

/* ==========================================================================
   10. SINCRONIZZAZIONE DATI (IndexedDB -> Memory State)
   ========================================================================== */
async function refreshData() {
  state.items = await db.getAllItems();
  state.documents = await db.getAllDocuments();
  state.suppliers = await db.getAllSuppliers();
  state.rfqs = await db.getAllRFQs();

  renderItemsTable();
  renderSuppliers();
  renderRfqHistory();

  // Aggiorna badge contatore documenti acquisiti
  const docCounter = document.getElementById('doc-count-badge');
  if (docCounter) docCounter.textContent = String(state.documents.length);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ==========================================================================
   11. INIZIALIZZAZIONE GLOBALE ALL'AVVIO DEL DOM
   ========================================================================== */
document.addEventListener('DOMContentLoaded', async () => {
  console.log('[DocuProcure] Inizializzazione PWA Enterprise...');

  // Registrazione Service Worker per funzionalità offline
  registerServiceWorker();

  // Monitoraggio connessione e banner PWA
  initNetworkStatusMonitoring();
  initInstallPrompt();

  // Interfaccia e navigazione
  initTabs();
  initFileUpload();
  initItemsTableEvents();
  initAdHocEvents();
  initRdoEvents();
  initSupplierEvents();

  // Caricamento dati da IndexedDB
  await refreshData();
  console.log('[DocuProcure] PWA pronta e operativa.');
});
