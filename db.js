/**
 * DocuProcure - IndexedDB Persistence Module
 * 
 * Modulo per la persistenza locale IndexedDB. Gestisce offline-first:
 * - Documenti caricati (PDF, Word, Immagini)
 * - Articoli estratti e normalizzati per il gestionale ERP
 * - Anagrafica Fornitori (Rubrica Ufficio Acquisti)
 * - Richieste di Offerta (RdO) generate e storicizzate
 * 
 * @module db
 */

const DB_NAME = 'DocuProcureDB';
const DB_VERSION = 1;

class DocuProcureDB {
  constructor() {
    this.db = null;
    this._initPromise = null;
  }

  /**
   * Inizializza la connessione al database IndexedDB creando gli Object Store necessari.
   * @returns {Promise<IDBDatabase>}
   */
  async init() {
    if (this.db) return this.db;
    if (this._initPromise) return this._initPromise;

    this._initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // 1. Store Documenti Inseriti
        if (!db.objectStoreNames.contains('documents')) {
          const docStore = db.createObjectStore('documents', { keyPath: 'id', autoIncrement: true });
          docStore.createIndex('timestamp', 'timestamp', { unique: false });
          docStore.createIndex('name', 'name', { unique: false });
        }

        // 2. Store Articoli Estratti
        if (!db.objectStoreNames.contains('items')) {
          const itemStore = db.createObjectStore('items', { keyPath: 'id', autoIncrement: true });
          itemStore.createIndex('documentId', 'documentId', { unique: false });
          itemStore.createIndex('code', 'code', { unique: false });
          itemStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // 3. Store Anagrafica Fornitori
        if (!db.objectStoreNames.contains('suppliers')) {
          const supStore = db.createObjectStore('suppliers', { keyPath: 'id', autoIncrement: true });
          supStore.createIndex('name', 'name', { unique: false });
          supStore.createIndex('category', 'category', { unique: false });
        }

        // 4. Store Storico Richieste di Offerta (RdO)
        if (!db.objectStoreNames.contains('rfqs')) {
          const rfqStore = db.createObjectStore('rfqs', { keyPath: 'id', autoIncrement: true });
          rfqStore.createIndex('rfqNumber', 'rfqNumber', { unique: true });
          rfqStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };

      request.onsuccess = async (event) => {
        this.db = event.target.result;
        // Inserisce fornitori demo predefiniti se la tabella è vuota
        await this._seedDefaultSuppliers();
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error('Errore nell\'apertura di IndexedDB:', event.target.error);
        reject(event.target.error);
      };
    });

    return this._initPromise;
  }

  /**
   * Helper per eseguire operazioni in transazione
   * @private
   */
  async _transaction(storeName, mode, callback) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);

      let result;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);

      result = callback(store);
    });
  }

  /**
   * Pre-popola fornitori d'esempio realistici per facilitare l'uso immediato
   * @private
   */
  async _seedDefaultSuppliers() {
    const existing = await this.getAllSuppliers();
    if (existing.length === 0) {
      const defaultSuppliers = [
        {
          name: 'Meccanica Precisione S.r.l.',
          email: 'preventivi@meccanicaprecisione.it',
          phone: '+39 02 8976541',
          vat: 'IT01234567891',
          contactPerson: 'Ing. Rossi',
          category: 'Lavorazioni Meccaniche & Minuterie',
          notes: 'Fornitore qualificato ISO 9001 - Resa DDP'
        },
        {
          name: 'Forniture Industriali Nord S.p.A.',
          email: 'commerciale@forniturenord.com',
          phone: '+39 011 4567890',
          vat: 'IT09876543210',
          contactPerson: 'Dott.ssa Bianchi',
          category: 'Cuscinetti & Trasmissioni',
          notes: 'Listino convenzionato sconto 35%'
        },
        {
          name: 'Elettro-Tech Componenti S.a.s.',
          email: 'ordini@elettro-tech.it',
          phone: '+39 051 6789123',
          vat: 'IT04561237895',
          contactPerson: 'Sig. Ferrari',
          category: 'Materiale Elettrico & Sensori',
          notes: 'Tempi medi di consegna 48h'
        }
      ];

      for (const sup of defaultSuppliers) {
        await this.saveSupplier(sup);
      }
    }
  }

  /* ==========================================================================
     GESTIONE DOCUMENTI
     ========================================================================== */

  async saveDocument(doc) {
    const docToSave = {
      name: doc.name,
      size: doc.size,
      type: doc.type,
      timestamp: doc.timestamp || Date.now(),
      textPreview: doc.textPreview || '',
      itemCount: doc.itemCount || 0,
      status: doc.status || 'Estratto'
    };

    return new Promise(async (resolve, reject) => {
      const db = await this.init();
      const tx = db.transaction('documents', 'readwrite');
      const store = tx.objectStore('documents');
      const request = store.add(docToSave);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getAllDocuments() {
    return new Promise(async (resolve, reject) => {
      const db = await this.init();
      const tx = db.transaction('documents', 'readonly');
      const store = tx.objectStore('documents');
      const request = store.getAll();

      request.onsuccess = () => {
        // Ordina dal più recente al più vecchio
        const docs = request.result.sort((a, b) => b.timestamp - a.timestamp);
        resolve(docs);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async deleteDocument(id) {
    return new Promise(async (resolve, reject) => {
      const db = await this.init();
      const tx = db.transaction(['documents', 'items'], 'readwrite');
      const docStore = tx.objectStore('documents');
      const itemStore = tx.objectStore('items');

      docStore.delete(Number(id));

      // Elimina anche tutti gli articoli associati a questo documento
      const itemIndex = itemStore.index('documentId');
      const req = itemIndex.openCursor(IDBKeyRange.only(Number(id)));
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  /* ==========================================================================
     GESTIONE ARTICOLI ESTRATTI (GESTIONALE ERP)
     ========================================================================== */

  async saveItems(items) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('items', 'readwrite');
      const store = tx.objectStore('items');

      items.forEach(item => {
        store.add({
          documentId: item.documentId || null,
          code: item.code || '',
          description: item.description || '',
          qty: Number(item.qty) || 1,
          unit: item.unit || 'PZ',
          unitPrice: Number(item.unitPrice) || 0,
          total: (Number(item.qty) || 1) * (Number(item.unitPrice) || 0),
          notes: item.notes || '',
          selected: true,
          timestamp: Date.now()
        });
      });

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async getAllItems() {
    return new Promise(async (resolve, reject) => {
      const db = await this.init();
      const tx = db.transaction('items', 'readonly');
      const store = tx.objectStore('items');
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async updateItem(item) {
    return new Promise(async (resolve, reject) => {
      const db = await this.init();
      const tx = db.transaction('items', 'readwrite');
      const store = tx.objectStore('items');
      const request = store.put(item);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteItem(id) {
    return new Promise(async (resolve, reject) => {
      const db = await this.init();
      const tx = db.transaction('items', 'readwrite');
      const store = tx.objectStore('items');
      const request = store.delete(Number(id));

      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  async clearAllItems() {
    return new Promise(async (resolve, reject) => {
      const db = await this.init();
      const tx = db.transaction('items', 'readwrite');
      const store = tx.objectStore('items');
      const request = store.clear();

      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  /* ==========================================================================
     GESTIONE ANAGRAFICA FORNITORI
     ========================================================================== */

  async getAllSuppliers() {
    return new Promise(async (resolve, reject) => {
      const db = await this.init();
      const tx = db.transaction('suppliers', 'readonly');
      const store = tx.objectStore('suppliers');
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async saveSupplier(supplier) {
    return new Promise(async (resolve, reject) => {
      const db = await this.init();
      const tx = db.transaction('suppliers', 'readwrite');
      const store = tx.objectStore('suppliers');
      const itemToSave = { ...supplier, timestamp: Date.now() };

      const request = supplier.id ? store.put(itemToSave) : store.add(itemToSave);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteSupplier(id) {
    return new Promise(async (resolve, reject) => {
      const db = await this.init();
      const tx = db.transaction('suppliers', 'readwrite');
      const store = tx.objectStore('suppliers');
      const request = store.delete(Number(id));

      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  /* ==========================================================================
     GESTIONE STORICO RICHIESTE DI OFFERTA (RdO)
     ========================================================================== */

  async saveRFQ(rfq) {
    return new Promise(async (resolve, reject) => {
      const db = await this.init();
      const tx = db.transaction('rfqs', 'readwrite');
      const store = tx.objectStore('rfqs');
      const itemToSave = {
        rfqNumber: rfq.rfqNumber || `RDO-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`,
        supplierId: rfq.supplierId || null,
        supplierName: rfq.supplierName || 'Fornitore Generico',
        supplierEmail: rfq.supplierEmail || '',
        deadlineDate: rfq.deadlineDate || '',
        deliveryDate: rfq.deliveryDate || '',
        paymentTerms: rfq.paymentTerms || 'Rimessa Diretta 30/60 gg d.f. f.m.',
        items: rfq.items || [],
        totalEstimated: rfq.totalEstimated || 0,
        notes: rfq.notes || '',
        status: rfq.status || 'Inviata',
        timestamp: Date.now()
      };

      const request = rfq.id ? store.put(itemToSave) : store.add(itemToSave);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getAllRFQs() {
    return new Promise(async (resolve, reject) => {
      const db = await this.init();
      const tx = db.transaction('rfqs', 'readonly');
      const store = tx.objectStore('rfqs');
      const request = store.getAll();

      request.onsuccess = () => {
        const rfqs = request.result.sort((a, b) => b.timestamp - a.timestamp);
        resolve(rfqs);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async deleteRFQ(id) {
    return new Promise(async (resolve, reject) => {
      const db = await this.init();
      const tx = db.transaction('rfqs', 'readwrite');
      const store = tx.objectStore('rfqs');
      const request = store.delete(Number(id));

      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }
}

// Esporta un'istanza singleton per l'intera applicazione
export const db = new DocuProcureDB();
