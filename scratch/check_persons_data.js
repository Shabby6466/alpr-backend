const sqlite3 = require('better-sqlite3');
const db = new sqlite3('data/alpr.sqlite');
const rows = db.prepare('SELECT id, name, length(faceTemplate) as tempLen, length(faceThumbnail) as thumbLen FROM persons').all();
console.log(rows);
