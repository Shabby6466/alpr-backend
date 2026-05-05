const sqlite3 = require('better-sqlite3');
const db = new sqlite3('data/alpr.sqlite');
const testTemplate = Buffer.alloc(1024, 0xAF);
const id = '26ea4b06-dcf0-48b8-85a4-fd83b50115cf';
const result = db.prepare('UPDATE persons SET faceTemplate = ? WHERE id = ?').run(testTemplate, id);
console.log('Update result:', result);
const row = db.prepare('SELECT length(faceTemplate) as len FROM persons WHERE id = ?').get(id);
console.log('Saved template length:', row.len);
