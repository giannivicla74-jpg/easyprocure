// Updated pattern for glued tokens like CONF.100CON
const line4 = "4 ZATT06200610 01 BULL.T/TONDA C/QUADR.SOTT.M6X10 CONF.100CON 7 7,00 5,90000 02/09/26";

// If UM is glued to the preceding word (e.g. 100CON), we separate it
const cleaned = line4.replace(/([0-9A-Za-z]+)(CON|CONF|PCE|PZ|LM|MT|NR|KG|LT)\s+([0-9]+)/i, "$1 $2 $3");
console.log('Cleaned line 4:', cleaned);

const pattern = /^(?:([0-9]{1,3})\s+)?([A-Z0-9\-_./]+(?:\s+[0-9]{2})*)\s+(.+?)\s+(LM|PCE|CON|CONF|PZ|NR|KG|LT|MT|CF|SET)\s+(?:([0-9]+(?:[.,][0-9]+)?)\s+)?([0-9]+(?:[.,][0-9]+)?)\s+([0-9]+(?:[.,][0-9]+)?)(?:\s+(?:[0-9.,]+))?(?:\s+([0-3]?[0-9]\/[0-1]?[0-9]\/[0-9]{2,4}))?$/i;

const m = cleaned.match(pattern);
console.log('Match result:', m ? {
  code: m[2],
  desc: m[3],
  um: m[4],
  qty: m[6],
  price: m[7]
} : 'NO MATCH');
